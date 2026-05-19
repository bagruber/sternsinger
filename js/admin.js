// js/admin.js — assign buildings to groups (territories) + cross-group access.
import { GROUPS, GROUP_COLOR } from "./groups.js";
import {
  fetchAllAssignments, upsertAssignment, deleteAssignment,
  fetchAllGroupAccess, upsertGroupAccess, deleteGroupAccess
} from "./api.js";
import { buildingsNearPoint } from "./map-util.js";

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
let isPainting = false;
let touchedThisStroke = new Set();

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
    if (g.id === currentGroup) return; // skip self
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
  // optimistic
  if (willEnable) granted.add(targetGroupId); else granted.delete(targetGroupId);
  btn.classList.toggle("active", willEnable);
  try {
    if (willEnable) {
      await upsertGroupAccess({ group_id: currentGroup, granted_group_id: targetGroupId });
    } else {
      await deleteGroupAccess({ group_id: currentGroup, granted_group_id: targetGroupId });
    }
  } catch (e) {
    // revert
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
      const id = feature.properties.id;
      layersById.set(id, layer);
    }
  }).addTo(map);
}

function buildingStyle(id) {
  const g = assignments[id];
  if (!g) return { color: "#555", weight: 1, fillColor: UNASSIGNED_FILL, fillOpacity: 0.25 };
  const fill = GROUP_COLOR[g] || "#888";
  return { color: "#222", weight: 1.5, fillColor: fill, fillOpacity: 0.7 };
}

// ─── Assign / Unassign ───
async function assignBuilding(id) {
  if (touchedThisStroke.has(id)) return;
  touchedThisStroke.add(id);

  const layer = layersById.get(id);
  if (!layer) return;
  const prev = assignments[id] || null;
  if (prev === currentGroup) return;

  history.push({ id, prev });
  assignments[id] = currentGroup;
  layer.setStyle(buildingStyle(id));
  if (navigator.vibrate) navigator.vibrate(8);

  upsertAssignment({ building_id: id, group_id: currentGroup })
    .catch(e => {
      console.warn("assign upsert failed:", e.message);
      showToast("Speichern fehlgeschlagen — Schema-Migration angewandt?");
    });
}

function unassignBuilding(id) {
  if (touchedThisStroke.has(id)) return;
  touchedThisStroke.add(id);

  const layer = layersById.get(id);
  if (!layer) return;
  const prev = assignments[id] || null;
  if (!prev) return;

  history.push({ id, prev });
  delete assignments[id];
  layer.setStyle(buildingStyle(id));
  if (navigator.vibrate) navigator.vibrate(8);

  deleteAssignment({ building_id: id })
    .catch(e => console.warn("assign delete failed:", e.message));
}

// ─── Touch / mouse ───
const mapEl = map.getContainer();

function isBrushMode() { return mode === "brush" || mode === "erase"; }
function applyMapDragPolicy() {
  if (isBrushMode()) map.dragging.disable();
  else map.dragging.enable();
}
function clientToContainerPoint(t) {
  const rect = mapEl.getBoundingClientRect();
  return L.point(t.clientX - rect.left, t.clientY - rect.top);
}

mapEl.addEventListener("touchstart", (e) => {
  if (!isBrushMode()) return;
  if (e.touches.length >= 2) { map.dragging.enable(); isPainting = false; return; }
  if (map.getZoom() < MIN_ZOOM) { showToast(`Zoom näher heran (mind. Stufe ${MIN_ZOOM})`); return; }
  e.preventDefault();
  map.dragging.disable();
  isPainting = true;
  touchedThisStroke = new Set();
  paintAtPoint(clientToContainerPoint(e.touches[0]));
}, { passive: false });

mapEl.addEventListener("touchmove", (e) => {
  if (!isBrushMode()) return;
  if (e.touches.length >= 2) { isPainting = false; map.dragging.enable(); return; }
  if (!isPainting) return;
  e.preventDefault();
  paintAtPoint(clientToContainerPoint(e.touches[0]));
}, { passive: false });

mapEl.addEventListener("touchend", () => { isPainting = false; }, { passive: false });

mapEl.addEventListener("mousedown", (e) => {
  if (!isBrushMode()) return;
  if (map.getZoom() < MIN_ZOOM) { showToast(`Zoom näher heran (mind. Stufe ${MIN_ZOOM})`); return; }
  isPainting = true;
  touchedThisStroke = new Set();
  const rect = mapEl.getBoundingClientRect();
  paintAtPoint(L.point(e.clientX - rect.left, e.clientY - rect.top));
});
mapEl.addEventListener("mousemove", (e) => {
  if (!isPainting || !isBrushMode()) return;
  const rect = mapEl.getBoundingClientRect();
  paintAtPoint(L.point(e.clientX - rect.left, e.clientY - rect.top));
});
window.addEventListener("mouseup", () => { isPainting = false; });

function paintAtPoint(containerPoint) {
  const ids = buildingsNearPoint(map, layersById, containerPoint, BRUSH_RADIUS_PX);
  if (mode === "brush") ids.forEach(assignBuilding);
  else if (mode === "erase") ids.forEach(unassignBuilding);
}

// ─── Undo ───
function undo() {
  const last = history.pop();
  if (!last) { showToast("Nichts rückgängig zu machen"); return; }
  const { id, prev } = last;
  const layer = layersById.get(id);
  if (prev) {
    assignments[id] = prev;
    upsertAssignment({ building_id: id, group_id: prev }).catch(() => {});
  } else {
    delete assignments[id];
    deleteAssignment({ building_id: id }).catch(() => {});
  }
  layer?.setStyle(buildingStyle(id));
  if (navigator.vibrate) navigator.vibrate([5, 30, 5]);
}

// ─── UI ───
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    applyMapDragPolicy();
    document.body.classList.toggle("edit-mode", isBrushMode());
  });
});
document.getElementById("undo-btn").addEventListener("click", undo);

map.on("zoom", () => {
  const w = document.getElementById("zoom-warning");
  w.classList.toggle("hidden", map.getZoom() >= MIN_ZOOM || !isBrushMode());
});

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 2500);
}

// ─── Boot ───
window.addEventListener("load", () => { if (window.lucide) lucide.createIcons(); });
renderGroupPalette();
loadAll();
applyMapDragPolicy();
