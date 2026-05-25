// js/dashboard.js — read+write aggregate view across all groups.
import {
  fetchAllAnnotations,
  fetchAllGroupAmounts,
  fetchAllAssignments,
  upsertGroupAmount,
  invalidateCache
} from "./api.js";
import { GROUP_NAMES as GROUPS, DAYS, PERIODS } from "./groups.js";
import { setupSyncChip } from "./sync-chip.js";

const PASSWORD = "sternsinger2027";

const filter = { day: "all", group: "all", period: "all" };
let allAnnotations = [];
let assignments = {};   // building_id → group_id
let amounts = new Map(); // `${group}|${day}|${period}` → { amount_cents, notes }
let lastRefreshAt = 0;
let refreshing = false;
let buildingLayer;
let buildingsGeoJSON = null;
let map;

// ─── Auth gate ───────────────────────────────────────────────────────────────
function showGate() {
  const gate = document.getElementById("auth-gate");
  const input = document.getElementById("auth-input");
  const submit = document.getElementById("auth-submit");
  const err = document.getElementById("auth-error");

  return new Promise(resolve => {
    const tryAuth = () => {
      if (input.value === PASSWORD) {
        sessionStorage.setItem("dash_auth", "ok");
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

async function authenticate() {
  if (sessionStorage.getItem("dash_auth") === "ok") {
    document.getElementById("auth-gate").style.display = "none";
    return true;
  }
  return showGate();
}

// ─── Map ─────────────────────────────────────────────────────────────────────
function initMap() {
  map = L.map("map", {
    center: [48.4689, 11.9376],
    zoom: 15,
    maxZoom: 19
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(map);
}

// ─── Filter UI ───────────────────────────────────────────────────────────────
function renderPills(containerId, options, key) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  el.appendChild(makePill("Alle", filter[key] === "all", null, () => {
    filter[key] = "all"; renderViews();
  }));
  options.forEach(opt => {
    el.appendChild(makePill(opt.label, filter[key] === opt.id, opt.color, () => {
      filter[key] = opt.id; renderViews();
    }));
  });
}
function makePill(text, active, color, onClick) {
  const b = document.createElement("button");
  b.className = "pill" + (active ? " active" : "");
  b.textContent = text;
  if (color) b.style.setProperty("--pill-accent", color);
  b.addEventListener("click", onClick);
  return b;
}
function renderFilters() {
  renderPills("filter-day", DAYS.map(d => ({ id: String(d.n), label: d.label, color: d.color })), "day");
  renderPills("filter-group", GROUPS.map(g => ({ id: g, label: g })), "group");
  renderPills("filter-period", PERIODS, "period");
}

// ─── Filtering ───────────────────────────────────────────────────────────────
function filteredAnnotations() {
  return allAnnotations.filter(a => {
    if (filter.day !== "all" && String(a.day) !== filter.day) return false;
    if (filter.group !== "all" && a.group_id !== filter.group) return false;
    if (filter.period !== "all" && a.period !== filter.period) return false;
    return true;
  });
}

// ─── Stats / map / list ──────────────────────────────────────────────────────
function renderViews() {
  renderFilters();
  const rows = filteredAnnotations();
  renderSummary(rows);
  renderStats(rows);
  renderSpecialList(rows);
  renderMap(rows);
  renderMobile();
}

// ─── Mobile cards ────────────────────────────────────────────────────────────
// Built from the FULL dataset (not the filtered set) — these are the
// "essentials at a glance" overview that should stay stable regardless of
// what the user pokes at in the filter pills.
function computeProgress() {
  const p = Object.fromEntries(GROUPS.map(g => [g, { painted: 0, assigned: 0 }]));
  Object.entries(assignments).forEach(([_bid, g]) => {
    if (p[g]) p[g].assigned++;
  });
  allAnnotations.forEach(a => {
    if (!a.color || !p[a.group_id]) return;
    if (assignments[a.building_id] === a.group_id) p[a.group_id].painted++;
  });
  return p;
}

function computeMoneyByGroup() {
  const m = Object.fromEntries(GROUPS.map(g => [g, 0]));
  for (const [key, v] of amounts) {
    const [g] = key.split("|");
    if (m[g] != null) m[g] += v.amount_cents || 0;
  }
  return m;
}

function renderMobile() {
  renderMobileOverall();
  renderMobileProgress();
  renderMobileMoney();
}

function renderMobileOverall() {
  const el = document.getElementById("mobile-overall");
  if (!el) return;
  const prog = computeProgress();
  const totals = Object.values(prog).reduce(
    (s, p) => ({ painted: s.painted + p.painted, assigned: s.assigned + p.assigned }),
    { painted: 0, assigned: 0 }
  );
  const pct = totals.assigned ? Math.round(100 * totals.painted / totals.assigned) : 0;
  const money = [...amounts.values()].reduce((s, v) => s + (v.amount_cents || 0), 0);
  el.innerHTML = `
    <div class="overall-row">
      <div class="overall-big">${pct}<span class="overall-pct">%</span></div>
      <div class="overall-meta">
        <div><strong>${totals.painted}</strong> / ${totals.assigned} Gebäude</div>
        <div><strong>${formatEuro(money)}</strong> gesammelt</div>
      </div>
    </div>
  `;
}

function renderMobileProgress() {
  const el = document.getElementById("mobile-progress-list");
  if (!el) return;
  const prog = computeProgress();
  el.innerHTML = "";
  GROUPS.forEach(g => {
    const { painted, assigned } = prog[g];
    const pct = assigned ? Math.round(100 * painted / assigned) : 0;
    const item = document.createElement("div");
    item.className = "mp-item";
    item.innerHTML = `
      <div class="mp-row">
        <div class="mp-label">${escapeHtml(g)}</div>
        <div class="mp-num">${painted}/${assigned}</div>
        <div class="mp-pct">${pct}%</div>
      </div>
      <div class="mp-bar"><div class="mp-fill" style="width:${Math.min(100, pct)}%"></div></div>
    `;
    el.appendChild(item);
  });
}

function renderMobileMoney() {
  const el = document.getElementById("mobile-money-list");
  if (!el) return;
  const money = computeMoneyByGroup();
  const max = Math.max(1, ...Object.values(money));
  el.innerHTML = "";
  GROUPS.forEach(g => {
    const cents = money[g];
    const pct = Math.round(100 * cents / max);
    const item = document.createElement("div");
    item.className = "mp-item";
    item.innerHTML = `
      <div class="mp-row">
        <div class="mp-label">${escapeHtml(g)}</div>
        <div class="mp-num mp-money">${formatEuro(cents)}</div>
      </div>
      <div class="mp-bar"><div class="mp-fill mp-money-fill" style="width:${pct}%"></div></div>
    `;
    el.appendChild(item);
  });
}

function renderSummary(rows) {
  const el = document.getElementById("dash-summary");
  const groups = new Set(rows.map(r => r.group_id)).size;
  const withTag = rows.filter(r => r.is_attention || r.is_important).length;
  const withComment = rows.filter(r => r.comment).length;
  el.innerHTML = `
    <div><strong>${rows.length}</strong> Markierungen</div>
    <div><strong>${groups}</strong> Gruppen aktiv</div>
    <div><strong>${withComment}</strong> Kommentare</div>
    <div><strong>${withTag}</strong> Sondermarkierungen</div>
  `;
}

function renderStats(rows) {
  fillTable("stats-by-group", GROUPS.map(g => [g, rows.filter(r => r.group_id === g).length]));
  fillTable("stats-by-day", DAYS.map(d => [d.label, rows.filter(r => r.day === d.n).length, d.color]));
  fillTable("stats-by-period", PERIODS.map(p => [p.label, rows.filter(r => r.period === p.id).length]));
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

function renderSpecialList(rows) {
  const list = document.getElementById("special-items");
  const specials = rows.filter(r => r.is_attention || r.is_important);
  if (specials.length === 0) {
    list.innerHTML = `<li class="empty">Keine Sondermarkierungen.</li>`;
    return;
  }
  list.innerHTML = "";
  specials.forEach(a => {
    const li = document.createElement("li");
    const badges = [];
    if (a.is_important) badges.push("★");
    if (a.is_attention) badges.push("!");
    const periodTxt = a.period === "morning" ? "VM" : a.period === "afternoon" ? "NM" : "";
    li.innerHTML = `
      <span class="badge">${badges.join(" ")}</span>
      <div>
        <div>${escapeHtml(a.group_id)} · Tag ${a.day}${periodTxt ? " " + periodTxt : ""}</div>
        ${a.comment ? `<div class="meta">${escapeHtml(a.comment)}</div>` : ""}
      </div>
    `;
    li.addEventListener("click", () => flyToBuilding(a.building_id));
    list.appendChild(li);
  });
}

function flyToBuilding(buildingId) {
  if (!buildingLayer) return;
  buildingLayer.eachLayer(layer => {
    if (layer.feature?.properties?.id === buildingId) {
      map.flyTo(layer.getBounds().getCenter(), Math.max(map.getZoom(), 18), { duration: 0.6 });
      layer.openPopup?.();
    }
  });
}

async function ensureBuildings() {
  if (!buildingsGeoJSON) {
    const res = await fetch("./data/buildings.geojson");
    buildingsGeoJSON = await res.json();
  }
}

async function renderMap(rows) {
  await ensureBuildings();
  const annById = new Map();
  rows.forEach(r => annById.set(r.building_id, r));

  if (buildingLayer) map.removeLayer(buildingLayer);
  buildingLayer = L.geoJSON(buildingsGeoJSON, {
    filter: f => annById.has(f.properties.id),
    style: f => {
      const a = annById.get(f.properties.id);
      return { color: "#222", weight: 1, fillColor: a.color || "#9aa3b5", fillOpacity: 0.8 };
    },
    onEachFeature: (f, layer) => {
      const a = annById.get(f.properties.id);
      const parts = [
        `<strong>${escapeHtml(a.group_id)}</strong>`,
        `Tag ${a.day}${a.period ? ` (${a.period === "morning" ? "vor" : "nach"} Mittag)` : ""}`
      ];
      if (a.is_important) parts.push("★ wichtig");
      if (a.is_attention) parts.push("! Aufmerksamkeit");
      if (a.comment) parts.push(`<em>${escapeHtml(a.comment)}</em>`);
      layer.bindPopup(parts.join("<br/>"));
    }
  }).addTo(map);
}

// ─── Amounts matrix ──────────────────────────────────────────────────────────
function amountKey(group, day, period) { return `${group}|${day}|${period}`; }

function renderAmountsTable() {
  const table = document.getElementById("amounts-table");

  // Header rows: 1) day spans, 2) period subheaders
  let head = "<thead><tr><th rowspan='2'>Gruppe</th>";
  DAYS.forEach(d => {
    head += `<th colspan='2' class='day-header' style='--day-color:${d.color}'>${d.label}</th>`;
  });
  head += "<th rowspan='2'>Summe</th></tr><tr>";
  DAYS.forEach(() => {
    PERIODS.forEach(p => { head += `<th>${p.short}</th>`; });
  });
  head += "</tr></thead>";

  // Body
  let body = "<tbody>";
  GROUPS.forEach(group => {
    body += `<tr><th>${escapeHtml(group)}</th>`;
    let groupTotal = 0;
    DAYS.forEach(d => {
      PERIODS.forEach(p => {
        const k = amountKey(group, d.n, p.id);
        const cur = amounts.get(k) || { amount_cents: 0, notes: null };
        const euros = cur.amount_cents ? (cur.amount_cents / 100).toFixed(2) : "";
        groupTotal += cur.amount_cents || 0;
        const hasNotes = cur.notes ? "has-notes" : "";
        body += `<td>
          <div class="amount-cell">
            <input class="amount-input" type="text" inputmode="decimal"
                   data-group="${escapeAttr(group)}" data-day="${d.n}" data-period="${p.id}"
                   value="${euros}" placeholder="0,00" />
            <button class="notes-btn ${hasNotes}" title="Notiz"
                    data-group="${escapeAttr(group)}" data-day="${d.n}" data-period="${p.id}">
              <i data-lucide="message-square"></i>
            </button>
          </div>
        </td>`;
      });
    });
    body += `<td class="row-total">${formatEuro(groupTotal)}</td></tr>`;
  });
  body += "</tbody>";

  // Footer
  let foot = "<tfoot><tr><td>Summe</td>";
  let grand = 0;
  DAYS.forEach(d => {
    PERIODS.forEach(p => {
      const sum = GROUPS.reduce((s, g) => s + (amounts.get(amountKey(g, d.n, p.id))?.amount_cents || 0), 0);
      grand += sum;
      foot += `<td class="col-total">${formatEuro(sum)}</td>`;
    });
  });
  foot += `<td class="col-total">${formatEuro(grand)}</td></tr></tfoot>`;

  table.innerHTML = head + body + foot;

  // Wire inputs
  table.querySelectorAll(".amount-input").forEach(inp => {
    inp.addEventListener("blur", () => saveAmount(inp));
    inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); });
  });
  table.querySelectorAll(".notes-btn").forEach(btn => {
    btn.addEventListener("click", () => openNotesDialog(btn.dataset.group, +btn.dataset.day, btn.dataset.period));
  });

  if (window.lucide) lucide.createIcons();
  renderAmountsTotals();
  renderMobile();
}

function renderAmountsTotals() {
  const total = [...amounts.values()].reduce((s, x) => s + (x.amount_cents || 0), 0);
  const filled = [...amounts.values()].filter(x => x.amount_cents > 0).length;
  document.getElementById("amounts-totals").innerHTML = `
    <div><strong>${formatEuro(total)}</strong> Gesamtsumme</div>
    <div><strong>${filled}</strong> ausgefüllte Felder</div>
  `;
}

function parseEuros(input) {
  const cleaned = input.replace(/\s|€/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
function formatEuro(cents) {
  return (cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

async function saveAmount(input) {
  const group = input.dataset.group;
  const day = +input.dataset.day;
  const period = input.dataset.period;
  const k = amountKey(group, day, period);
  const cur = amounts.get(k) || { amount_cents: 0, notes: null };

  const cents = input.value.trim() ? parseEuros(input.value) : 0;
  if (cents === null) {
    input.value = cur.amount_cents ? (cur.amount_cents / 100).toFixed(2) : "";
    return;
  }
  if (cents === cur.amount_cents) return;

  amounts.set(k, { ...cur, amount_cents: cents });
  try {
    await upsertGroupAmount({ group_id: group, day, period, amount_cents: cents, notes: cur.notes });
  } catch (e) {
    console.warn("amount save failed:", e.message);
  }
  renderAmountsTable();
}

// ─── Notes dialog ────────────────────────────────────────────────────────────
function openNotesDialog(group, day, period) {
  const k = amountKey(group, day, period);
  const cur = amounts.get(k) || { amount_cents: 0, notes: null };
  const dlg = document.getElementById("notes-dialog");
  document.getElementById("notes-context").textContent = `${group} · Tag ${day} · ${period === "morning" ? "VM" : "NM"}`;
  const ta = document.getElementById("notes-input");
  ta.value = cur.notes || "";
  dlg.showModal();

  dlg.onclose = async () => {
    if (dlg.returnValue !== "save") return;
    const notes = ta.value.trim() || null;
    if (notes === (cur.notes || null)) return;
    amounts.set(k, { ...cur, notes });
    try {
      await upsertGroupAmount({ group_id: group, day, period, amount_cents: cur.amount_cents || 0, notes });
    } catch (e) {
      console.warn("notes save failed:", e.message);
    }
    renderAmountsTable();
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, "&#39;"); }

// ─── Boot ────────────────────────────────────────────────────────────────────
window.addEventListener("load", () => {
  if (window.lucide) lucide.createIcons();
  setupSyncChip("sync-chip");
});

(async () => {
  const ok = await authenticate();
  if (!ok) return;

  initMap();

  const loaded = await loadData();
  if (!loaded) return;

  renderViews();
  renderAmountsTable();
  wireRefreshButton();
  setInterval(updateLastRefreshLabel, 30 * 1000);
})();

// ─── Refresh ────────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const [annRows, amtRows, assignRows] = await Promise.all([
      fetchAllAnnotations(),
      fetchAllGroupAmounts(),
      fetchAllAssignments().catch(e => { console.warn("assignments load failed:", e.message); return []; })
    ]);
    allAnnotations = annRows;
    amounts = new Map(amtRows.map(r => [amountKey(r.group_id, r.day, r.period), { amount_cents: r.amount_cents, notes: r.notes }]));
    assignments = {};
    assignRows.forEach(r => { assignments[r.building_id] = r.group_id; });
    lastRefreshAt = Date.now();
    updateLastRefreshLabel();
    return true;
  } catch (e) {
    document.getElementById("dash-summary").innerHTML = `<div class="err">Fehler beim Laden: ${escapeHtml(e.message)}</div>`;
    return false;
  }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const btn = document.getElementById("refresh-btn");
  btn?.classList.add("spinning");
  // Explicit refresh: bypass any cached assignment/access data.
  invalidateCache("assignments");
  invalidateCache("access");
  try {
    const ok = await loadData();
    if (ok) {
      renderViews();
      renderAmountsTable();
    }
  } finally {
    refreshing = false;
    btn?.classList.remove("spinning");
  }
}

function wireRefreshButton() {
  const btn = document.getElementById("refresh-btn");
  if (!btn) return;
  btn.addEventListener("click", refresh);
}

function relativeTime(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 30) return "gerade eben";
  if (sec < 60) return `vor ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `vor ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `vor ${hr} Std`;
  const days = Math.floor(hr / 24);
  return `vor ${days} ${days === 1 ? "Tag" : "Tagen"}`;
}

function updateLastRefreshLabel() {
  const el = document.getElementById("last-refresh");
  if (!el || !lastRefreshAt) return;
  el.textContent = relativeTime(Date.now() - lastRefreshAt);
}
