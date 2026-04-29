// js/app.js
import { fetchAnnotations, upsertAnnotation, deleteAnnotation, fetchGroupAmount, upsertGroupAmount } from "./api.js";

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
const NEUTRAL_FILL = "#9aa3b5"; // building marked but no color (tag/comment only)

// ─── State ───────────────────────────────────────────────────────────────────
let mode = "idle";          // idle | brush | erase | detail
let currentDay = 1;
let currentPeriod = localStorage.getItem("currentPeriod") || "morning";
let groupId = "";
let annotations = {};       // building_id → { day, period, color, comment, is_attention, is_important }
let history = [];           // [{id, prev: ann|null}]
let layersById = new Map();
let buildingLayer;
let isPainting = false;
let touchedThisStroke = new Set();

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
      annotations[a.building_id] = {
        day: a.day, period: a.period, color: a.color, comment: a.comment,
        is_attention: !!a.is_attention, is_important: !!a.is_important
      };
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

function buildingStyle(id) {
  const ann = annotations[id];
  if (!ann) return { color: "#555", weight: 1.5, fillColor: "#c8c8c8", fillOpacity: 0.35 };
  const fill = ann.color || NEUTRAL_FILL;
  return { color: "#555", weight: 1.5, fillColor: fill, fillOpacity: 0.75 };
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

// ─── Brush / Erase ───────────────────────────────────────────────────────────
function paintBuilding(id) {
  if (touchedThisStroke.has(id)) return;
  touchedThisStroke.add(id);

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
}

function eraseBuilding(id) {
  if (touchedThisStroke.has(id)) return;
  touchedThisStroke.add(id);

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
    layer.setStyle({ fillColor: "#c8c8c8", fillOpacity: 0.35 });
    layer.unbindTooltip();
    deleteAnnotation({ building_id: id, group_id: groupId })
      .catch(e => console.warn("delete failed:", e.message));
  }
  if (navigator.vibrate) navigator.vibrate(8);
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

// ─── Touch / mouse (brush+erase only) ────────────────────────────────────────
const mapEl = map.getContainer();

function isEditMode() { return mode !== "idle"; }
function isBrushMode() { return mode === "brush" || mode === "erase"; }

function applyMapDragPolicy() {
  if (isEditMode()) map.dragging.disable();
  else map.dragging.enable();
}

function clientToContainerPoint(t) {
  const rect = mapEl.getBoundingClientRect();
  return L.point(t.clientX - rect.left, t.clientY - rect.top);
}

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

mapEl.addEventListener("touchend", () => { isPainting = false; }, { passive: false });

function paintAtPoint(containerPoint) {
  const ids = buildingsNearPoint(containerPoint, BRUSH_RADIUS_PX);
  if (mode === "brush") ids.forEach(paintBuilding);
  else if (mode === "erase") ids.forEach(eraseBuilding);
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
    layer?.setStyle({ fillColor: "#c8c8c8", fillOpacity: 0.35 });
    layer?.unbindTooltip();
    deleteAnnotation({ building_id: id, group_id: groupId })
      .catch(e => console.warn("delete failed:", e.message));
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
function undo() {
  const last = history.pop();
  if (!last) { showToast("Nichts rückgängig zu machen"); return; }
  const { id, prev } = last;
  const layer = layersById.get(id);
  if (!prev) {
    delete annotations[id];
    layer?.setStyle({ fillColor: "#c8c8c8", fillOpacity: 0.35 });
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
