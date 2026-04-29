// js/app.js
import { fetchAnnotations, upsertAnnotation, deleteAnnotation, patchComment } from "./api.js";

// ─── Config ──────────────────────────────────────────────────────────────────
const GROUPS = [
  "Stadt",
  "Feldkirchner Au",
  "Neustadt I",
  "Neustadt II",
  "Bonau",
  "Westerberg",
  "Oberes Gereuth",
  "Unteres Gereuth"
];
const DAYS = [
  { n: 1, color: "#e74c3c", label: "Tag 1" },
  { n: 2, color: "#e67e22", label: "Tag 2" },
  { n: 3, color: "#2ecc71", label: "Tag 3" },
  { n: 4, color: "#3498db", label: "Tag 4" }
];
const MIN_ZOOM = 16;
const BRUSH_RADIUS_PX = 40;
const LONG_PRESS_MS = 600;

// ─── State ───────────────────────────────────────────────────────────────────
let mode = "idle";          // idle | brush | erase | single
let currentDay = 1;
let currentPeriod = localStorage.getItem("currentPeriod") || "morning";
let groupId = "";
let annotations = {};       // building_id → { day, color, comment, tag }
let history = [];           // [{id, prev: ann|null}]
let layersById = new Map(); // id → leaflet layer
let buildingLayer;
let isPainting = false;
let touchedThisStroke = new Set(); // dedupe within one swipe
let longPressTimer = null;
let longPressFired = false; // suppress click that follows a long-press

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
    b.addEventListener("click", () => {
      groupId = name;
      localStorage.setItem("groupId", groupId);
      document.getElementById("group-modal").classList.add("hidden");
      updateGroupDisplay();
      loadAnnotations();
    });
    c.appendChild(b);
  });
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
    const data = await fetchAnnotations(groupId);
    annotations = {};
    data.forEach(a => {
      annotations[a.building_id] = { day: a.day, period: a.period, color: a.color, comment: a.comment, tag: a.tag };
    });
  } catch (e) {
    console.warn("Could not load annotations:", e.message);
  }
  renderBuildings();
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
      const ann = annotations[id];
      if (ann?.comment) {
        layer.bindTooltip("💬", { permanent: true, className: "comment-badge", direction: "center" });
      }
    }
  }).addTo(map);
}

function attachLayerHandlers(id, layer) {
  // Single-mode tap: leaflet's click event fires reliably on touch + mouse.
  layer.on("click", () => {
    if (mode !== "single") return;
    if (longPressFired) { longPressFired = false; return; }
    if (map.getZoom() < MIN_ZOOM) {
      showToast(`Zoom näher heran (mind. Stufe ${MIN_ZOOM})`);
      return;
    }
    toggleSingle(id);
  });

  // Long-press: start timer on press, fire dialog after threshold, cancel on move/up.
  const startPress = () => {
    if (mode !== "single") return;
    if (map.getZoom() < MIN_ZOOM) return;
    cancelLongPress();
    longPressFired = false;
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      longPressFired = true;
      if (navigator.vibrate) navigator.vibrate(20);
      openCommentDialog(id);
    }, LONG_PRESS_MS);
  };
  layer.on("mousedown", startPress);
  layer.on("touchstart", startPress);
  const cancel = () => cancelLongPress();
  layer.on("mouseup", cancel);
  layer.on("mouseout", cancel);
  layer.on("touchend", cancel);
  layer.on("touchcancel", cancel);
  layer.on("touchmove", cancel);
}

function buildingStyle(id) {
  const ann = annotations[id];
  return {
    color: "#555",
    weight: 1.5,
    fillColor: ann ? ann.color : "#c8c8c8",
    fillOpacity: ann ? 0.75 : 0.35
  };
}

// ─── Painting primitives ─────────────────────────────────────────────────────
function paintBuilding(id) {
  if (touchedThisStroke.has(id)) return;
  touchedThisStroke.add(id);

  const layer = layersById.get(id);
  if (!layer) return;

  const existing = annotations[id];
  // Tag-Sperre: brush ignoriert bereits markierte Häuser, egal welcher Tag
  if (existing) return;

  const day = DAYS.find(d => d.n === currentDay);
  const period = currentPeriod;
  history.push({ id, prev: null });
  annotations[id] = { day: currentDay, period, color: day.color };
  layer.setStyle({ fillColor: day.color, fillOpacity: 0.9 });
  setTimeout(() => layer.setStyle({ fillOpacity: 0.75 }), 120);
  if (navigator.vibrate) navigator.vibrate(8);

  upsertAnnotation({ building_id: id, group_id: groupId, day: currentDay, period, color: day.color })
    .catch(e => console.warn("upsert failed:", e.message));
}

function eraseBuilding(id) {
  if (touchedThisStroke.has(id)) return;
  touchedThisStroke.add(id);

  const layer = layersById.get(id);
  if (!layer) return;
  const existing = annotations[id];
  // Tag-Sperre: erase nur eigenen Tag
  if (!existing || existing.day !== currentDay) return;

  history.push({ id, prev: { ...existing } });
  delete annotations[id];
  layer.setStyle({ fillColor: "#c8c8c8", fillOpacity: 0.35 });
  layer.unbindTooltip();
  if (navigator.vibrate) navigator.vibrate(8);

  deleteAnnotation({ building_id: id, group_id: groupId })
    .catch(e => console.warn("delete failed:", e.message));
}

function toggleSingle(id) {
  const existing = annotations[id];
  if (existing) {
    if (existing.day !== currentDay) {
      showToast(`Markiert in Tag ${existing.day} — dort wechseln zum Ändern`);
      return;
    }
    touchedThisStroke.clear();
    eraseBuilding(id);
  } else {
    touchedThisStroke.clear();
    paintBuilding(id);
  }
}

// ─── Hit testing ─────────────────────────────────────────────────────────────
function buildingsNearPoint(containerPoint, radiusPx) {
  const hits = [];
  const bounds = map.getBounds();
  layersById.forEach((layer, id) => {
    if (!bounds.intersects(layer.getBounds())) return;
    const center = layer.getBounds().getCenter();
    const cp = map.latLngToContainerPoint(center);
    const dx = cp.x - containerPoint.x;
    const dy = cp.y - containerPoint.y;
    if (dx * dx + dy * dy <= radiusPx * radiusPx) hits.push(id);
  });
  return hits;
}

// ─── Touch / mouse ───────────────────────────────────────────────────────────
const mapEl = map.getContainer();

function isEditMode() { return mode !== "idle"; }

function applyMapDragPolicy() {
  // In edit modes: 1-finger drag = paint, 2-finger = pan. We disable Leaflet's
  // built-in dragging and re-enable it only when 2 fingers are detected.
  if (isEditMode()) map.dragging.disable();
  else map.dragging.enable();
}

function clientToContainerPoint(t) {
  const rect = mapEl.getBoundingClientRect();
  return L.point(t.clientX - rect.left, t.clientY - rect.top);
}

function isBrushMode() { return mode === "brush" || mode === "erase"; }

mapEl.addEventListener("touchstart", (e) => {
  if (!isBrushMode()) return;
  if (e.touches.length >= 2) {
    map.dragging.enable();
    isPainting = false;
    return;
  }
  if (map.getZoom() < MIN_ZOOM) {
    showToast(`Zoom näher heran (mind. Stufe ${MIN_ZOOM})`);
    return;
  }
  e.preventDefault();
  map.dragging.disable();
  isPainting = true;
  touchedThisStroke = new Set();
  paintAtPoint(clientToContainerPoint(e.touches[0]));
}, { passive: false });

mapEl.addEventListener("touchmove", (e) => {
  if (!isBrushMode()) return;
  if (e.touches.length >= 2) {
    isPainting = false;
    map.dragging.enable();
    return;
  }
  if (!isPainting) return;
  e.preventDefault();
  paintAtPoint(clientToContainerPoint(e.touches[0]));
}, { passive: false });

mapEl.addEventListener("touchend", () => {
  isPainting = false;
}, { passive: false });

function paintAtPoint(containerPoint) {
  const ids = buildingsNearPoint(containerPoint, BRUSH_RADIUS_PX);
  if (mode === "brush") ids.forEach(paintBuilding);
  else if (mode === "erase") ids.forEach(eraseBuilding);
}

function cancelLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
}

function openCommentDialog(id) {
  const layer = layersById.get(id);
  const existing = annotations[id]?.comment || "";
  const dlg = document.getElementById("comment-dialog");
  document.getElementById("comment-input").value = existing;
  document.getElementById("comment-building-id").textContent = id;
  dlg.classList.remove("hidden");
  document.getElementById("comment-input").focus();

  document.getElementById("comment-save").onclick = () => {
    const text = document.getElementById("comment-input").value.trim();
    if (!annotations[id]) {
      const day = DAYS.find(d => d.n === currentDay);
      annotations[id] = { day: currentDay, period: currentPeriod, color: day.color };
      layer?.setStyle({ fillColor: day.color, fillOpacity: 0.75 });
    }
    annotations[id].comment = text || null;

    const ann = annotations[id];
    if (text) {
      upsertAnnotation({ building_id: id, group_id: groupId, day: ann.day, period: ann.period, color: ann.color, comment: text })
        .catch(e => console.warn("comment upsert failed:", e.message));
      layer?.bindTooltip("💬", { permanent: true, className: "comment-badge", direction: "center" });
    } else {
      patchComment({ building_id: id, group_id: groupId, comment: null })
        .catch(e => console.warn("comment patch failed:", e.message));
      layer?.unbindTooltip();
    }
    dlg.classList.add("hidden");
  };
  document.getElementById("comment-cancel").onclick = () => dlg.classList.add("hidden");
}

// ─── Undo ────────────────────────────────────────────────────────────────────
function undo() {
  const last = history.pop();
  if (!last) { showToast("Nichts rückgängig zu machen"); return; }
  const { id, prev } = last;
  const layer = layersById.get(id);
  if (!prev) {
    delete annotations[id];
    layer?.setStyle({ fillColor: "#c8c8c8", fillOpacity: 0.35 });
    deleteAnnotation({ building_id: id, group_id: groupId }).catch(() => {});
  } else {
    annotations[id] = { ...prev };
    layer?.setStyle({ fillColor: prev.color, fillOpacity: 0.75 });
    upsertAnnotation({ building_id: id, group_id: groupId, day: prev.day, period: prev.period, color: prev.color, comment: prev.comment, tag: prev.tag })
      .catch(() => {});
  }
  if (navigator.vibrate) navigator.vibrate([5, 30, 5]);
}

// ─── Mode buttons ────────────────────────────────────────────────────────────
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
  if (btn.dataset.period === currentPeriod) btn.classList.add("active");
  else btn.classList.remove("active");
  btn.addEventListener("click", () => {
    currentPeriod = btn.dataset.period;
    localStorage.setItem("currentPeriod", currentPeriod);
    document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// ─── Zoom warning ────────────────────────────────────────────────────────────
map.on("zoom", () => {
  const w = document.getElementById("zoom-warning");
  w.classList.toggle("hidden", map.getZoom() >= MIN_ZOOM || !isEditMode());
});

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 2500);
}

// ─── Boot ────────────────────────────────────────────────────────────────────
window.addEventListener("load", () => {
  if (window.lucide) lucide.createIcons();
});
renderDayPicker();
renderGroupList();
setupGroup();
applyMapDragPolicy();
