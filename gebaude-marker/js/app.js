// js/app.js
import { fetchAnnotations, upsertAnnotation, deleteAnnotation, patchComment } from "./api.js";

// ─── State ───────────────────────────────────────────────────────────────────
let mode = "brush";         // brush | erase | single
let isPainting = false;
let activeColor = "#e74c3c";
let history = [];           // [{layer, prevColor, prevAnnotated}]
let groupId = "";
let annotations = {};       // building_id → { color, comment }
let longPressTimer = null;
let longPressTarget = null;

const COLORS = ["#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#3498db", "#9b59b6"];
const MIN_ZOOM = 17;

// ─── Map Init ─────────────────────────────────────────────────────────────────
const map = L.map("map", {
  center: [49.0192, 12.0975],
  zoom: 18,
  zoomControl: false,
  attributionControl: true
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 21
}).addTo(map);

// Add zoom control top-right
L.control.zoom({ position: "topright" }).addTo(map);

// ─── Group Setup ──────────────────────────────────────────────────────────────
function setupGroup() {
  const stored = localStorage.getItem("groupId");
  if (stored) {
    groupId = stored;
    updateGroupDisplay();
    loadAnnotations();
    return;
  }
  showGroupModal();
}

function showGroupModal() {
  document.getElementById("group-modal").classList.remove("hidden");
}

document.getElementById("group-confirm").addEventListener("click", () => {
  const input = document.getElementById("group-input").value.trim();
  if (!input) return;
  groupId = input;
  localStorage.setItem("groupId", groupId);
  document.getElementById("group-modal").classList.add("hidden");
  updateGroupDisplay();
  loadAnnotations();
});

document.getElementById("group-change").addEventListener("click", () => {
  localStorage.removeItem("groupId");
  groupId = "";
  showGroupModal();
});

function updateGroupDisplay() {
  document.getElementById("group-label").textContent = groupId;
}

// ─── Load GeoJSON + Annotations ───────────────────────────────────────────────
let buildingLayer;

async function loadAnnotations() {
  if (!groupId) return;
  try {
    const data = await fetchAnnotations(groupId);
    annotations = {};
    data.forEach(a => { annotations[a.building_id] = { color: a.color, comment: a.comment }; });
  } catch (e) {
    console.warn("Could not load annotations (Supabase not configured?):", e.message);
    // Continue with empty annotations for demo
  }
  renderBuildings();
}

async function renderBuildings() {
  const res = await fetch("./data/buildings.geojson");
  const geojson = await res.json();

  if (buildingLayer) map.removeLayer(buildingLayer);

  buildingLayer = L.geoJSON(geojson, {
    style: feature => buildingStyle(feature.properties.id),
    onEachFeature: (feature, layer) => {
      attachTouchHandlers(feature, layer);
    }
  }).addTo(map);
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

// ─── Touch / Mouse Handlers ───────────────────────────────────────────────────
function attachTouchHandlers(feature, layer) {
  const id = feature.properties.id;

  // Mouse (desktop)
  layer.on("mousedown", (e) => { if (e.originalEvent.button === 0) startInteract(layer, id, e); });
  layer.on("mouseover", (e) => { if (isPainting) interact(layer, id); });
  layer.on("mouseup",   () => { isPainting = false; });

  // Touch (mobile)
  layer.on("touchstart", (e) => {
    const t = e.originalEvent.touches;
    if (t.length !== 1) { isPainting = false; return; }
    L.DomEvent.preventDefault(e.originalEvent);
    startInteract(layer, id, e);
    startLongPress(layer, id);
  });

  layer.on("touchmove", (e) => {
    const t = e.originalEvent.touches;
    if (t.length !== 1) { isPainting = false; return; }
    L.DomEvent.preventDefault(e.originalEvent);
    cancelLongPress();
    if (isPainting) interact(layer, id);
  });

  layer.on("touchend",   () => { isPainting = false; cancelLongPress(); });
  layer.on("touchcancel", () => { isPainting = false; cancelLongPress(); });
}

function startInteract(layer, id, e) {
  if (map.getZoom() < MIN_ZOOM) {
    showToast(`Zoom näher heran (mind. Stufe ${MIN_ZOOM})`);
    return;
  }
  if (mode === "single") {
    toggleSingle(layer, id);
  } else {
    isPainting = true;
    interact(layer, id);
  }
}

function interact(layer, id) {
  if (map.getZoom() < MIN_ZOOM) return;
  if (mode === "brush") paintLayer(layer, id, activeColor);
  else if (mode === "erase") eraseLayer(layer, id);
}

function paintLayer(layer, id, color) {
  const prev = annotations[id] ? annotations[id].color : null;
  const prevAnnotated = !!annotations[id];
  history.push({ layer, id, prevColor: prev, prevAnnotated });

  annotations[id] = { ...annotations[id], color };
  layer.setStyle({ fillColor: color, fillOpacity: 0.9 });
  setTimeout(() => layer.setStyle({ fillOpacity: 0.75 }), 120);
  if (navigator.vibrate) navigator.vibrate(10);

  upsertAnnotation({ building_id: id, group_id: groupId, color, comment: annotations[id]?.comment || null })
    .catch(e => console.warn("upsert failed:", e.message));
}

function eraseLayer(layer, id) {
  if (!annotations[id]) return;
  const prev = annotations[id].color;
  history.push({ layer, id, prevColor: prev, prevAnnotated: true });

  delete annotations[id];
  layer.setStyle({ fillColor: "#c8c8c8", fillOpacity: 0.35 });
  if (navigator.vibrate) navigator.vibrate(8);

  deleteAnnotation({ building_id: id, group_id: groupId })
    .catch(e => console.warn("delete failed:", e.message));
}

function toggleSingle(layer, id) {
  if (annotations[id]) {
    eraseLayer(layer, id);
  } else {
    paintLayer(layer, id, activeColor);
  }
}

// ─── Long Press ───────────────────────────────────────────────────────────────
function startLongPress(layer, id) {
  longPressTimer = setTimeout(() => {
    isPainting = false;
    openCommentDialog(layer, id);
  }, 600);
}

function cancelLongPress() {
  clearTimeout(longPressTimer);
}

function openCommentDialog(layer, id) {
  const existing = annotations[id]?.comment || "";
  const dlg = document.getElementById("comment-dialog");
  document.getElementById("comment-input").value = existing;
  document.getElementById("comment-building-id").textContent = id;
  dlg.classList.remove("hidden");
  document.getElementById("comment-input").focus();

  document.getElementById("comment-save").onclick = () => {
    const text = document.getElementById("comment-input").value.trim();
    if (!annotations[id]) annotations[id] = { color: activeColor };
    annotations[id].comment = text || null;

    if (text) {
      const color = annotations[id].color || activeColor;
      upsertAnnotation({ building_id: id, group_id: groupId, color, comment: text })
        .catch(e => console.warn("comment upsert failed:", e.message));
    } else {
      patchComment({ building_id: id, group_id: groupId, comment: null })
        .catch(e => console.warn("comment patch failed:", e.message));
    }

    // Show comment indicator
    if (text) {
      layer.bindTooltip("💬", { permanent: true, className: "comment-badge", direction: "center" });
      if (!layer.isTooltipOpen()) layer.openTooltip();
    } else {
      layer.unbindTooltip();
    }

    dlg.classList.add("hidden");
  };

  document.getElementById("comment-cancel").onclick = () => {
    dlg.classList.add("hidden");
  };
}

// ─── Undo ─────────────────────────────────────────────────────────────────────
function undo() {
  const last = history.pop();
  if (!last) { showToast("Nichts rückgängig zu machen"); return; }
  const { layer, id, prevColor, prevAnnotated } = last;

  if (!prevAnnotated) {
    delete annotations[id];
    layer.setStyle({ fillColor: "#c8c8c8", fillOpacity: 0.35 });
    deleteAnnotation({ building_id: id, group_id: groupId }).catch(() => {});
  } else {
    annotations[id] = { ...annotations[id], color: prevColor };
    layer.setStyle({ fillColor: prevColor, fillOpacity: 0.75 });
    upsertAnnotation({ building_id: id, group_id: groupId, color: prevColor }).catch(() => {});
  }

  if (navigator.vibrate) navigator.vibrate([5, 30, 5]);
}

// ─── UI Controls ──────────────────────────────────────────────────────────────
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

document.getElementById("undo-btn").addEventListener("click", undo);

document.querySelectorAll(".color-swatch").forEach(swatch => {
  swatch.addEventListener("click", () => {
    activeColor = swatch.dataset.color;
    document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("active"));
    swatch.classList.add("active");
    // Auto-switch to brush
    mode = "brush";
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    document.querySelector('[data-mode="brush"]').classList.add("active");
  });
});

// Init color swatches
function initSwatches() {
  const container = document.getElementById("color-picker");
  COLORS.forEach((c, i) => {
    const s = document.createElement("div");
    s.className = "color-swatch" + (i === 0 ? " active" : "");
    s.dataset.color = c;
    s.style.background = c;
    s.addEventListener("click", () => {
      activeColor = c;
      document.querySelectorAll(".color-swatch").forEach(x => x.classList.remove("active"));
      s.classList.add("active");
      mode = "brush";
      document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
      document.querySelector('[data-mode="brush"]').classList.add("active");
    });
    container.appendChild(s);
  });
}

// ─── Zoom Warning ─────────────────────────────────────────────────────────────
map.on("zoom", () => {
  const warning = document.getElementById("zoom-warning");
  if (map.getZoom() < MIN_ZOOM) {
    warning.classList.remove("hidden");
  } else {
    warning.classList.add("hidden");
  }
});

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 2500);
}

// ─── Block map pan on 1-finger when painting ──────────────────────────────────
map.on("touchstart", (e) => {
  if (e.originalEvent.touches.length === 1 && isPainting) {
    map.dragging.disable();
  }
});
map.on("touchend", () => map.dragging.enable());

// ─── Boot ─────────────────────────────────────────────────────────────────────
initSwatches();
setupGroup();
