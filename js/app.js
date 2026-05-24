// js/app.js
import {
  fetchAllAnnotations, upsertAnnotation, deleteAnnotation,
  fetchGroupAmount, upsertGroupAmount,
  fetchAllAssignments, fetchAllGroupAccess
} from "./api.js";
import { GROUP_NAMES as GROUPS, DAYS } from "./groups.js";
import { setupBrush } from "./brush.js";

const MIN_ZOOM = 16;
const BRUSH_RADIUS_PX = 40;
const NEUTRAL_FILL = "#9aa3b5"; // building marked but no color (tag/comment only)

// ─── State ───────────────────────────────────────────────────────────────────
let mode = "idle";          // idle | brush | erase | detail
let currentDay = 1;
let currentPeriod = localStorage.getItem("currentPeriod") || "morning";
let groupId = "";
let annotations = {};       // building_id → own annotation
let foreignAnn = {};        // building_id → { group_id, color } for other groups (display-only)
let assignments = {};       // building_id → group_id (territory)
let allowedGroups = new Set();  // groups whose territory I can paint
let history = [];           // [{id, prev: ann|null}]
let layersById = new Map();
let buildingLayer;

// ─── Map ─────────────────────────────────────────────────────────────────────
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

// ─── Group setup ─────────────────────────────────────────────────────────────
// Soft password protection: the first 4 chars of the group name (lowercased)
// must be entered to pick a group. Not real security — just enough friction
// that a member doesn't accidentally tap into the wrong group's data.
function requiredPasswordFor(name) {
  return name.slice(0, 4).toLowerCase();
}

function setupGroup() {
  const stored = localStorage.getItem("groupId");
  if (stored && GROUPS.includes(stored)) {
    groupId = stored;
    updateGroupDisplay();
    loadAnnotations();
  } else {
    showGroupModal();
  }
}
function showGroupModal() {
  document.getElementById("group-modal").classList.remove("hidden");
}
function renderGroupList() {
  const c = document.getElementById("group-list");
  c.innerHTML = "";
  GROUPS.forEach(name => {
    const b = document.createElement("button");
    b.className = "group-option";
    b.textContent = name;
    b.addEventListener("click", () => tryPickGroup(name));
    c.appendChild(b);
  });
}

function tryPickGroup(name) {
  const required = requiredPasswordFor(name);
  const entered = prompt(`Passwort für „${name}" (Hinweis: 4 Buchstaben):`);
  if (entered == null) return; // cancelled
  if (entered.toLowerCase().trim() !== required) {
    showToast("Falsches Passwort");
    return;
  }
  groupId = name;
  localStorage.setItem("groupId", groupId);
  document.getElementById("group-modal").classList.add("hidden");
  updateGroupDisplay();
  loadAnnotations();
}
function updateGroupDisplay() {
  document.getElementById("group-label").textContent = groupId;
}
document.getElementById("group-chip").addEventListener("click", showGroupModal);

// ─── Day picker ──────────────────────────────────────────────────────────────
function renderDayPicker() {
  const c = document.getElementById("day-picker");
  c.innerHTML = "";
  DAYS.forEach(d => {
    const b = document.createElement("button");
    b.className = "day-btn" + (d.n === currentDay ? " active" : "");
    b.dataset.day = d.n;
    b.style.setProperty("--day-color", d.color);
    b.textContent = d.n;
    b.addEventListener("click", () => {
      currentDay = d.n;
      document.querySelectorAll(".day-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
    });
    c.appendChild(b);
  });
}

// ─── Load buildings + annotations ────────────────────────────────────────────
async function loadAnnotations() {
  if (!groupId) return;
  try {
    const [annRows, assignRows, accessRows] = await Promise.all([
      fetchAllAnnotations(),
      fetchAllAssignments().catch(e => { console.warn("assignments load failed:", e.message); return []; }),
      fetchAllGroupAccess().catch(e => { console.warn("access load failed:", e.message); return []; })
    ]);
    annotations = {};
    foreignAnn = {};
    annRows.forEach(a => {
      if (a.group_id === groupId) {
        annotations[a.building_id] = {
          day: a.day, period: a.period, color: a.color, comment: a.comment,
          is_attention: !!a.is_attention, is_important: !!a.is_important
        };
      } else if (a.color) {
        // Only display-track foreign annotations that have a color.
        foreignAnn[a.building_id] = { group_id: a.group_id, color: a.color };
      }
    });
    assignments = {};
    assignRows.forEach(r => { assignments[r.building_id] = r.group_id; });
    allowedGroups = new Set([groupId]);
    accessRows.forEach(r => {
      if (r.group_id === groupId) allowedGroups.add(r.granted_group_id);
    });
  } catch (e) {
    console.warn("Could not load data:", e.message);
  }
  renderBuildings();
  updateProgress();
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
      attachLayerHandlers(id, layer);
      bindBadge(id, layer);
    }
  }).addTo(map);
}

function attachLayerHandlers(id, layer) {
  layer.on("click", () => {
    if (mode !== "detail") return;
    if (map.getZoom() < MIN_ZOOM) {
      showToast(`Zoom näher heran (mind. Stufe ${MIN_ZOOM})`);
      return;
    }
    openDetailDialog(id);
  });
}

function isAllowed(buildingId) {
  // Before any territories are configured, fall back to allowing everything
  // so the app stays usable. Once the admin has assigned anything, we gate.
  if (Object.keys(assignments).length === 0) return true;
  const g = assignments[buildingId];
  return !!g && allowedGroups.has(g);
}

function buildingStyle(id) {
  const ann = annotations[id];
  const allowed = isAllowed(id);

  // Own annotation always wins.
  if (ann) {
    const fill = ann.color || NEUTRAL_FILL;
    return { color: "#555", weight: 1.5, fillColor: fill, fillOpacity: 0.85 };
  }
  // My territory, unpainted — highlighted "available".
  if (allowed) {
    return { color: "#555", weight: 1.5, fillColor: "#eef2fb", fillOpacity: 0.6 };
  }
  // Foreign group's paint — dimmed colour hint so the user still sees activity.
  const foreign = foreignAnn[id];
  if (foreign) {
    return { color: "#3a3d4a", weight: 0.5, fillColor: foreign.color, fillOpacity: 0.18 };
  }
  // Everything else (other territory unpainted, or unassigned) — silhouette.
  return { color: "#3a3d4a", weight: 0.4, fillColor: "#5a5f70", fillOpacity: 0.14 };
}

function bindBadge(id, layer) {
  const ann = annotations[id];
  layer.unbindTooltip();
  if (!ann) return;
  const parts = [];
  if (ann.is_important) parts.push("★");
  if (ann.is_attention) parts.push("!");
  if (ann.comment) parts.push("💬");
  if (parts.length === 0) return;
  layer.bindTooltip(parts.join(" "), { permanent: true, className: "comment-badge", direction: "center" });
}

// ─── Brush / Erase (called once per building per stroke by the brush) ──────
function paintBuilding(id) {
  // Block painting outside the group's permitted territory.
  if (!isAllowed(id)) return;

  const layer = layersById.get(id);
  if (!layer) return;

  const existing = annotations[id];
  // Tag-Sperre: brush ignoriert bereits markierte Häuser, egal welcher Tag
  if (existing) return;

  const day = DAYS.find(d => d.n === currentDay);
  history.push({ id, prev: null });
  annotations[id] = {
    day: currentDay, period: currentPeriod, color: day.color,
    comment: null, is_attention: false, is_important: false
  };
  layer.setStyle({ fillColor: day.color, fillOpacity: 0.9 });
  setTimeout(() => layer.setStyle({ fillOpacity: 0.75 }), 120);
  if (navigator.vibrate) navigator.vibrate(8);

  upsertAnnotation({
    building_id: id, group_id: groupId,
    day: currentDay, period: currentPeriod, color: day.color
  }).catch(e => console.warn("upsert failed:", e.message));
  updateProgress();
}

function eraseBuilding(id) {
  const layer = layersById.get(id);
  if (!layer) return;
  const existing = annotations[id];
  // Tag-Sperre: erase nur eigenen Tag, und nur wenn keine Sondermarkierung/Kommentar dranhängt
  if (!existing) return;
  if (existing.day !== currentDay) return;
  if (!existing.color) return; // nothing to erase

  history.push({ id, prev: { ...existing } });

  const stillHasContent = existing.is_attention || existing.is_important || existing.comment;
  if (stillHasContent) {
    // Keep the row, just drop the color → neutral fill, tooltip stays.
    annotations[id] = { ...existing, color: null };
    layer.setStyle({ fillColor: NEUTRAL_FILL, fillOpacity: 0.75 });
    upsertAnnotation({
      building_id: id, group_id: groupId,
      day: existing.day, period: existing.period, color: null,
      comment: existing.comment, is_attention: existing.is_attention, is_important: existing.is_important
    }).catch(e => console.warn("erase upsert failed:", e.message));
  } else {
    delete annotations[id];
    layer.setStyle(buildingStyle(id));
    layer.unbindTooltip();
    deleteAnnotation({ building_id: id, group_id: groupId })
      .catch(e => console.warn("delete failed:", e.message));
  }
  if (navigator.vibrate) navigator.vibrate(8);
  updateProgress();
}

// ─── Brush wiring ────────────────────────────────────────────────────────────
function isEditMode() { return mode !== "idle"; }

const brush = setupBrush(map, {
  getMode: () => mode,
  onPaint: paintBuilding,
  onErase: eraseBuilding,
  layersById,
  minZoom: MIN_ZOOM,
  radiusPx: BRUSH_RADIUS_PX,
  onZoomBlocked: () => showToast(`Zoom näher heran (mind. Stufe ${MIN_ZOOM})`),
});

// Detail mode still wants map dragging disabled so single-tap selects
// a building cleanly. The brush helper only governs brush/erase, so
// we override the drag policy here for the broader "edit mode" set.
function applyMapDragPolicy() {
  if (isEditMode()) map.dragging.disable();
  else map.dragging.enable();
}

// ─── Detail dialog ───────────────────────────────────────────────────────────
function openDetailDialog(id) {
  const dlg = document.getElementById("detail-dialog");
  const ann = annotations[id] || null;

  // Local working copy (committed on Save).
  const draft = {
    color:        ann?.color ?? null,
    is_important: ann?.is_important ?? false,
    is_attention: ann?.is_attention ?? false,
    comment:      ann?.comment ?? ""
  };

  // Color buttons (5 options: keine + 4 days).
  const colorContainer = document.getElementById("detail-colors");
  colorContainer.innerHTML = "";
  const noneBtn = document.createElement("button");
  noneBtn.className = "detail-color none" + (draft.color === null ? " active" : "");
  noneBtn.textContent = "Keine";
  noneBtn.addEventListener("click", () => {
    draft.color = null;
    refreshColors();
  });
  colorContainer.appendChild(noneBtn);
  DAYS.forEach(d => {
    const b = document.createElement("button");
    b.className = "detail-color" + (draft.color === d.color ? " active" : "");
    b.style.setProperty("--day-color", d.color);
    b.textContent = d.n;
    b.addEventListener("click", () => {
      draft.color = d.color;
      refreshColors();
    });
    colorContainer.appendChild(b);
  });
  function refreshColors() {
    [...colorContainer.children].forEach(child => {
      const isNone = child.classList.contains("none");
      const matches = isNone ? draft.color === null : child.style.getPropertyValue("--day-color") === draft.color;
      child.classList.toggle("active", matches);
    });
  }

  // Tag toggles.
  document.querySelectorAll(".tag-toggle").forEach(btn => {
    const key = btn.dataset.tag;
    btn.classList.toggle("active", !!draft[key]);
    btn.onclick = () => {
      draft[key] = !draft[key];
      btn.classList.toggle("active", draft[key]);
    };
  });

  // Comment.
  const ta = document.getElementById("detail-comment");
  ta.value = draft.comment;

  dlg.classList.remove("hidden");

  // Save.
  document.getElementById("detail-save").onclick = () => {
    draft.comment = ta.value.trim();
    saveDetail(id, ann, draft);
    dlg.classList.add("hidden");
  };
  document.getElementById("detail-cancel").onclick = () => dlg.classList.add("hidden");
}

function saveDetail(id, prev, draft) {
  const empty = !draft.color && !draft.is_attention && !draft.is_important && !draft.comment;
  const layer = layersById.get(id);

  history.push({ id, prev: prev ? { ...prev } : null });

  if (empty) {
    delete annotations[id];
    if (layer) layer.setStyle(buildingStyle(id));
    layer?.unbindTooltip();
    deleteAnnotation({ building_id: id, group_id: groupId })
      .catch(e => console.warn("delete failed:", e.message));
    updateProgress();
    return;
  }

  // Pick a day for the row: use existing if available, else currentDay.
  const day = prev?.day ?? currentDay;
  const period = prev?.period ?? currentPeriod;

  const next = {
    day, period,
    color: draft.color,
    comment: draft.comment || null,
    is_attention: !!draft.is_attention,
    is_important: !!draft.is_important
  };
  annotations[id] = next;

  const fill = next.color || NEUTRAL_FILL;
  layer?.setStyle({ fillColor: fill, fillOpacity: 0.75 });
  bindBadge(id, layer);
  if (navigator.vibrate) navigator.vibrate(10);

  upsertAnnotation({
    building_id: id, group_id: groupId,
    day: next.day, period: next.period,
    color: next.color, comment: next.comment,
    is_attention: next.is_attention, is_important: next.is_important
  }).catch(e => console.warn("upsert failed:", e.message));
  updateProgress();
}

// ─── Amount dialog ───────────────────────────────────────────────────────────
function parseEuros(text) {
  const cleaned = text.replace(/\s|€/g, "").replace(",", ".");
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
function formatEuros(cents) {
  if (!cents) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

async function openAmountDialog() {
  if (!groupId) { showToast("Erst Gruppe wählen"); return; }
  const dlg = document.getElementById("amount-dialog");
  const ctx = document.getElementById("amount-context");
  const inp = document.getElementById("amount-input");
  const notes = document.getElementById("amount-notes");

  ctx.textContent = `${groupId} · Tag ${currentDay} · ${currentPeriod === "morning" ? "Vor Mittag" : "Nach Mittag"}`;
  inp.value = "";
  notes.value = "";

  dlg.classList.remove("hidden");

  // Load current value in background (don't block).
  fetchGroupAmount({ group_id: groupId, day: currentDay, period: currentPeriod })
    .then(row => {
      if (!row) return;
      inp.value = formatEuros(row.amount_cents);
      notes.value = row.notes || "";
    })
    .catch(e => console.warn("amount load failed:", e.message));

  document.getElementById("amount-save").onclick = async () => {
    const cents = parseEuros(inp.value);
    if (cents === null) { showToast("Ungültiger Betrag"); return; }
    try {
      await upsertGroupAmount({
        group_id: groupId, day: currentDay, period: currentPeriod,
        amount_cents: cents, notes: notes.value.trim() || null
      });
      showToast("Gespeichert");
    } catch (e) {
      showToast("Fehler: " + e.message);
      return;
    }
    dlg.classList.add("hidden");
  };
  document.getElementById("amount-cancel").onclick = () => dlg.classList.add("hidden");
}

document.getElementById("amount-btn").addEventListener("click", openAmountDialog);

// ─── Undo ────────────────────────────────────────────────────────────────────
function updateProgress() {
  let denom = 0, num = 0;
  for (const [bid, g] of Object.entries(assignments)) {
    if (!allowedGroups.has(g)) continue;
    denom++;
    if (annotations[bid]?.color) num++;
  }
  const el = document.getElementById("progress-chip");
  if (!el) return;
  if (!denom) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const pct = Math.round((100 * num) / denom);
  el.textContent = `${pct}% · ${num}/${denom}`;
}

function undo() {
  const last = history.pop();
  if (!last) { showToast("Nichts rückgängig zu machen"); return; }
  const { id, prev } = last;
  const layer = layersById.get(id);
  if (!prev) {
    delete annotations[id];
    if (layer) layer.setStyle(buildingStyle(id));
    layer?.unbindTooltip();
    deleteAnnotation({ building_id: id, group_id: groupId }).catch(() => {});
  } else {
    annotations[id] = { ...prev };
    const fill = prev.color || NEUTRAL_FILL;
    layer?.setStyle({ fillColor: fill, fillOpacity: 0.75 });
    bindBadge(id, layer);
    upsertAnnotation({
      building_id: id, group_id: groupId,
      day: prev.day, period: prev.period, color: prev.color,
      comment: prev.comment, is_attention: prev.is_attention, is_important: prev.is_important
    }).catch(() => {});
  }
  if (navigator.vibrate) navigator.vibrate([5, 30, 5]);
  updateProgress();
}

// ─── UI controls ─────────────────────────────────────────────────────────────
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    applyMapDragPolicy();
    document.body.classList.toggle("edit-mode", isEditMode());
  });
});
document.getElementById("undo-btn").addEventListener("click", undo);

document.querySelectorAll(".period-btn").forEach(btn => {
  btn.classList.toggle("active", btn.dataset.period === currentPeriod);
  btn.addEventListener("click", () => {
    currentPeriod = btn.dataset.period;
    localStorage.setItem("currentPeriod", currentPeriod);
    document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

map.on("zoom", () => {
  const w = document.getElementById("zoom-warning");
  w.classList.toggle("hidden", map.getZoom() >= MIN_ZOOM || !isEditMode());
});

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 2500);
}

// ─── Boot ────────────────────────────────────────────────────────────────────
window.addEventListener("load", () => { if (window.lucide) lucide.createIcons(); });
renderDayPicker();
renderGroupList();
setupGroup();
applyMapDragPolicy();
