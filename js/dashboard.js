// js/dashboard.js — read-only aggregate view across all groups.
import { fetchAllAnnotations } from "./api.js";

const GROUPS = [
  "Stadt", "Feldkirchner Au", "Neustadt I", "Neustadt II",
  "Bonau", "Westerberg", "Oberes Gereuth", "Unteres Gereuth"
];
const DAYS = [
  { n: 1, color: "#e74c3c", label: "Tag 1" },
  { n: 2, color: "#e67e22", label: "Tag 2" },
  { n: 3, color: "#2ecc71", label: "Tag 3" },
  { n: 4, color: "#3498db", label: "Tag 4" }
];
const PERIODS = [
  { id: "morning",   label: "Vor Mittag"   },
  { id: "afternoon", label: "Nach Mittag" }
];

const filter = { day: "all", group: "all", period: "all" };
let allAnnotations = [];
let buildingLayer;

const map = L.map("map", {
  center: [48.4689, 11.9376],
  zoom: 15,
  maxZoom: 19
});
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19
}).addTo(map);

// ─── Filter UI ───────────────────────────────────────────────────────────────
function renderPills(containerId, options, key) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  const all = makePill("Alle", filter[key] === "all");
  all.addEventListener("click", () => {
    filter[key] = "all";
    renderAll();
  });
  el.appendChild(all);
  options.forEach(opt => {
    const pill = makePill(opt.label, filter[key] === opt.id, opt.color);
    pill.addEventListener("click", () => {
      filter[key] = opt.id;
      renderAll();
    });
    el.appendChild(pill);
  });
}
function makePill(text, active, color) {
  const b = document.createElement("button");
  b.className = "pill" + (active ? " active" : "");
  b.textContent = text;
  if (color) b.style.setProperty("--pill-accent", color);
  return b;
}

function renderFilters() {
  renderPills("filter-day",
    DAYS.map(d => ({ id: String(d.n), label: d.label, color: d.color })),
    "day");
  renderPills("filter-group",
    GROUPS.map(g => ({ id: g, label: g })),
    "group");
  renderPills("filter-period", PERIODS, "period");
}

// ─── Data filtering ──────────────────────────────────────────────────────────
function filtered() {
  return allAnnotations.filter(a => {
    if (filter.day !== "all" && String(a.day) !== filter.day) return false;
    if (filter.group !== "all" && a.group_id !== filter.group) return false;
    if (filter.period !== "all" && a.period !== filter.period) return false;
    return true;
  });
}

// ─── Render ──────────────────────────────────────────────────────────────────
async function renderAll() {
  renderFilters();
  const rows = filtered();
  renderSummary(rows);
  renderStats(rows);
  await renderMap(rows);
}

function renderSummary(rows) {
  const el = document.getElementById("dash-summary");
  const groups = new Set(rows.map(r => r.group_id)).size;
  const withTag = rows.filter(r => r.tag).length;
  const withComment = rows.filter(r => r.comment).length;
  el.innerHTML = `
    <div><strong>${rows.length}</strong> Markierungen</div>
    <div><strong>${groups}</strong> Gruppen aktiv</div>
    <div><strong>${withComment}</strong> Kommentare</div>
    <div><strong>${withTag}</strong> Sondermarkierungen</div>
  `;
}

function renderStats(rows) {
  // by group
  fillTable("stats-by-group", GROUPS.map(g => {
    const n = rows.filter(r => r.group_id === g).length;
    return [g, n];
  }));
  // by day
  fillTable("stats-by-day", DAYS.map(d => {
    const n = rows.filter(r => r.day === d.n).length;
    return [d.label, n, d.color];
  }));
  // by period
  fillTable("stats-by-period", PERIODS.map(p => {
    const n = rows.filter(r => r.period === p.id).length;
    return [p.label, n];
  }));
}

function fillTable(blockId, data) {
  const table = document.querySelector(`#${blockId} table`);
  const total = data.reduce((s, r) => s + r[1], 0);
  table.innerHTML = data.map(([label, n, accent]) => {
    const pct = total ? Math.round((n / total) * 100) : 0;
    const dot = accent ? `<span class="dot" style="background:${accent}"></span>` : "";
    return `<tr>
      <td>${dot}${label}</td>
      <td class="num">${n}</td>
      <td class="bar"><div style="width:${pct}%;${accent ? `background:${accent}` : ""}"></div></td>
    </tr>`;
  }).join("");
}

async function renderMap(rows) {
  const annById = new Map();
  rows.forEach(r => annById.set(r.building_id, r));

  if (!window.__buildings) {
    const res = await fetch("./data/buildings.geojson");
    window.__buildings = await res.json();
  }
  if (buildingLayer) map.removeLayer(buildingLayer);
  buildingLayer = L.geoJSON(window.__buildings, {
    filter: f => annById.has(f.properties.id),
    style: f => {
      const a = annById.get(f.properties.id);
      return { color: "#222", weight: 1, fillColor: a.color, fillOpacity: 0.8 };
    },
    onEachFeature: (f, layer) => {
      const a = annById.get(f.properties.id);
      const parts = [
        `<strong>${a.group_id}</strong>`,
        `Tag ${a.day}${a.period ? ` (${a.period === "morning" ? "vor" : "nach"} Mittag)` : ""}`
      ];
      if (a.comment) parts.push(`<em>${escapeHtml(a.comment)}</em>`);
      if (a.tag) parts.push(`Markierung: ${a.tag}`);
      layer.bindPopup(parts.join("<br/>"));
    }
  }).addTo(map);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
}

// ─── Boot ────────────────────────────────────────────────────────────────────
window.addEventListener("load", () => {
  if (window.lucide) lucide.createIcons();
});

(async () => {
  try {
    allAnnotations = await fetchAllAnnotations();
  } catch (e) {
    document.getElementById("dash-summary").innerHTML = `<div class="err">Fehler beim Laden: ${e.message}</div>`;
    return;
  }
  await renderAll();
})();
