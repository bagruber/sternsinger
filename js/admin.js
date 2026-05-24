// js/admin.js — assign buildings to groups (territories) + cross-group access.
import { GROUPS, GROUP_COLOR } from "./groups.js";
import {
  fetchAllAssignments, upsertAssignmentsBulk, deleteAssignmentsBulk,
  fetchAllGroupAccess, upsertGroupAccess, deleteGroupAccess
} from "./api.js";
import { setupBrush } from "./brush.js";

const MIN_ZOOM = 16;
const BRUSH_RADIUS_PX = 40;
const UNASSIGNED_FILL = "#c8c8c8";

let mode = "idle";              // idle | brush | erase
let currentGroup = localStorage.getItem("adminCurrentGroup") || GROUPS[0].id;
let assignments = {};           // building_id → group_id
let access = {};                // group_id → Set<granted_group_id>
let history = [];               // [{ id, prev: group_id|null }]
let layersById = new Map();
let buildingLayer;

// Pending writes, keyed by building_id. Value is the target group_id, or
// null to mean "delete this assignment". Drained by a serialized chain so
// new items queued while a flush is in flight always get a follow-up flush.
let pending = new Map();
let flushChain = Promise.resolve();
let heartbeat = null;

// ─── Map ───
const map = L.map("map", {
  center: [48.4689, 11.9376],
  zoom: 16,
  zoomControl: false,
  attributionControl: true,
  maxZoom: 19
});
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19
}).addTo(map);
L.control.zoom({ position: "topright" }).addTo(map);

// ─── Group palette ───
function renderGroupPalette() {
  const c = document.getElementById("group-palette");
  c.innerHTML = "";
  GROUPS.forEach(g => {
    const b = document.createElement("button");
    b.className = "group-swatch" + (g.id === currentGroup ? " active" : "");
    b.style.setProperty("--swatch-color", g.color);
    b.title = g.id;
    b.textContent = g.id.charAt(0);
    b.addEventListener("click", () => {
      currentGroup = g.id;
      localStorage.setItem("adminCurrentGroup", currentGroup);
      document.querySelectorAll(".group-swatch").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      updateGroupChipLabel();
      renderAccessRow();
    });
    c.appendChild(b);
  });
  updateGroupChipLabel();
}
function updateGroupChipLabel() {
  const chip = document.getElementById("admin-chip");
  const span = chip.querySelector("span");
  if (span) span.textContent = currentGroup;
  chip.style.setProperty("--chip-color", GROUP_COLOR[currentGroup] || "#888");
}

// ─── Access row (cross-group sharing) ───
function ensureAccessSet(groupId) {
  if (!access[groupId]) access[groupId] = new Set();
  return access[groupId];
}

function renderAccessRow() {
  const c = document.getElementById("access-row");
  c.innerHTML = "";
  const granted = ensureAccessSet(currentGroup);
  GROUPS.forEach(g => {
    if (g.id === currentGroup) return;
    const b = document.createElement("button");
    const on = granted.has(g.id);
    b.className = "access-chip" + (on ? " active" : "");
    b.style.setProperty("--swatch-color", g.color);
    b.title = `${currentGroup} darf auch ${g.id} bearbeiten`;
    b.textContent = g.id.charAt(0);
    b.addEventListener("click", () => toggleAccess(g.id, b));
    c.appendChild(b);
  });
}

async function toggleAccess(targetGroupId, btn) {
  const granted = ensureAccessSet(currentGroup);
  const willEnable = !granted.has(targetGroupId);
  if (willEnable) granted.add(targetGroupId); else granted.delete(targetGroupId);
  btn.classList.toggle("active", willEnable);
  try {
    if (willEnable) {
      await upsertGroupAccess({ group_id: currentGroup, granted_group_id: targetGroupId });
    } else {
      await deleteGroupAccess({ group_id: currentGroup, granted_group_id: targetGroupId });
    }
  } catch (e) {
    if (willEnable) granted.delete(targetGroupId); else granted.add(targetGroupId);
    btn.classList.toggle("active", !willEnable);
    showToast("Speichern fehlgeschlagen: " + e.message);
  }
}

// ─── Data ───
async function loadAll() {
  try {
    const [assignRows, accessRows] = await Promise.all([
      fetchAllAssignments(),
      fetchAllGroupAccess().catch(e => { console.warn("access load failed:", e.message); return []; })
    ]);
    assignments = {};
    assignRows.forEach(r => { assignments[r.building_id] = r.group_id; });
    access = {};
    accessRows.forEach(r => ensureAccessSet(r.group_id).add(r.granted_group_id));
  } catch (e) {
    console.warn("Could not load admin data:", e.message);
    showToast("Konnte Daten nicht laden — Schema-Migration angewandt?");
  }
  renderAccessRow();
  await renderBuildings();
}

async function renderBuildings() {
  const res = await fetch("./data/buildings.geojson");
  const geojson = await res.json();
  if (buildingLayer) map.removeLayer(buildingLayer);
  layersById.clear();

  buildingLayer = L.geoJSON(geojson, {
    style: feature => buildingStyle(feature.properties.id),
    onEachFeature: (feature, layer) => {
      layersById.set(feature.properties.id, layer);
    }
  }).addTo(map);
}

function buildingStyle(id) {
  const g = assignments[id];
  if (!g) return { color: "#555", weight: 1, fillColor: UNASSIGNED_FILL, fillOpacity: 0.25 };
  const fill = GROUP_COLOR[g] || "#888";
  return { color: "#222", weight: 1.5, fillColor: fill, fillOpacity: 0.7 };
}

// ─── Assign / Unassign (called once per building per stroke by the brush) ───
function assignBuilding(id) {
  const layer = layersById.get(id);
  if (!layer) return;
  const prev = assignments[id] || null;
  if (prev === currentGroup) return;

  history.push({ id, prev });
  assignments[id] = currentGroup;
  layer.setStyle(buildingStyle(id));
  if (navigator.vibrate) navigator.vibrate(8);

  queue(id, currentGroup);
}

function unassignBuilding(id) {
  const layer = layersById.get(id);
  if (!layer) return;
  const prev = assignments[id] || null;
  if (!prev) return;

  history.push({ id, prev });
  delete assignments[id];
  layer.setStyle(buildingStyle(id));
  if (navigator.vibrate) navigator.vibrate(8);

  queue(id, null);
}

// ─── Pending-write queue + serialized flush ───
function queue(id, value) {
  pending.set(id, value);
  scheduleHeartbeat();
}

function scheduleHeartbeat() {
  if (heartbeat) return;
  heartbeat = setTimeout(() => { heartbeat = null; flushPending(); }, 800);
}

function flushPending() {
  if (heartbeat) { clearTimeout(heartbeat); heartbeat = null; }
  flushChain = flushChain.then(doFlush, doFlush);
  return flushChain;
}

async function doFlush() {
  if (pending.size === 0) return;
  const batch = pending;
  pending = new Map();

  const toUpsert = [];
  const toDelete = [];
  for (const [id, g] of batch) {
    if (g === null) toDelete.push(id);
    else toUpsert.push({ building_id: id, group_id: g });
  }
  try {
    if (toUpsert.length) await upsertAssignmentsBulk(toUpsert);
    if (toDelete.length) await deleteAssignmentsBulk(toDelete);
    showToast(`${batch.size} gespeichert`);
  } catch (e) {
    console.warn("flush failed:", e);
    for (const [id, g] of batch) {
      if (!pending.has(id)) pending.set(id, g);
    }
    showToast(`Fehler beim Speichern: ${e.message}`);
    scheduleHeartbeat();
  }
}

// ─── Brush wiring ───
const brush = setupBrush(map, {
  getMode: () => mode,
  onPaint: assignBuilding,
  onErase: unassignBuilding,
  onStrokeEnd: flushPending,
  layersById,
  minZoom: MIN_ZOOM,
  radiusPx: BRUSH_RADIUS_PX,
  onZoomBlocked: () => showToast(`Zoom näher heran (mind. Stufe ${MIN_ZOOM})`),
});

// ─── Undo ───
function undo() {
  const last = history.pop();
  if (!last) { showToast("Nichts rückgängig zu machen"); return; }
  const { id, prev } = last;
  const layer = layersById.get(id);
  if (prev) {
    assignments[id] = prev;
    queue(id, prev);
  } else {
    delete assignments[id];
    queue(id, null);
  }
  layer?.setStyle(buildingStyle(id));
  if (navigator.vibrate) navigator.vibrate([5, 30, 5]);
  flushPending();
}

// ─── UI ───
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    brush.refreshDragPolicy();
    document.body.classList.toggle("edit-mode", mode === "brush" || mode === "erase");
    flushPending();
  });
});
document.getElementById("undo-btn").addEventListener("click", undo);

// Tab hidden — flush so writes survive a phone lock or background.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) flushPending();
});

// Intercept navigation so pending writes finish before we leave the page.
const homeLink = document.getElementById("home-link");
if (homeLink) {
  homeLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const href = homeLink.href;
    while (pending.size > 0) {
      await flushPending();
    }
    await flushChain;
    window.location.href = href;
  });
}

map.on("zoom", () => {
  const w = document.getElementById("zoom-warning");
  const isBrush = mode === "brush" || mode === "erase";
  w.classList.toggle("hidden", map.getZoom() >= MIN_ZOOM || !isBrush);
});

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 2500);
}

// ─── Auth gate ───
const ADMIN_PASSWORD = "admin";

function authenticate() {
  if (sessionStorage.getItem("admin_auth") === "ok") {
    document.getElementById("auth-gate").style.display = "none";
    return Promise.resolve(true);
  }
  return new Promise(resolve => {
    const gate = document.getElementById("auth-gate");
    const input = document.getElementById("auth-input");
    const submit = document.getElementById("auth-submit");
    const err = document.getElementById("auth-error");
    const tryAuth = () => {
      if (input.value === ADMIN_PASSWORD) {
        sessionStorage.setItem("admin_auth", "ok");
        gate.style.display = "none";
        resolve(true);
      } else {
        err.classList.remove("hidden");
        input.value = "";
        input.focus();
      }
    };
    submit.addEventListener("click", tryAuth);
    input.addEventListener("keydown", e => { if (e.key === "Enter") tryAuth(); });
    input.focus();
  });
}

// ─── Boot ───
window.addEventListener("load", () => { if (window.lucide) lucide.createIcons(); });
(async () => {
  await authenticate();
  renderGroupPalette();
  loadAll();
  brush.refreshDragPolicy();
})();
