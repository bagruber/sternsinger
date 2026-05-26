// js/api.js — Supabase REST client.

const SUPABASE_URL = "https://kgrmlzlagahsjpsgatoc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8xrpeD4PUXFRBlz9n6g9NQ_2DULIHpV";

const headers = () => ({
  "Content-Type": "application/json",
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  "Prefer": "return=minimal"
});

// Supabase enforces a server-side cap (db-max-rows, default 1000) that
// ignores `limit` query params, so bulk fetches must paginate. Loop until
// a page returns fewer rows than the page size.
const PAGE_SIZE = 1000;

// ─── sessionStorage cache ────────────────────────────────────────────────────
// Bulk fetches dominate the cold load time when switching pages (admin ↔ app
// ↔ dashboard). Cache slow-changing data so a quick round trip uses the cache
// and only the actually-volatile annotations get re-fetched.
//
// Writers below call invalidateCache() to keep things honest when the user
// themselves changes the data.

const CACHE_TTL_MS = 60 * 1000;       // 60s — short enough to feel fresh

function cacheRead(key) {
  try {
    const raw = sessionStorage.getItem(`cache:${key}`);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}

function cacheWrite(key, data) {
  try {
    sessionStorage.setItem(`cache:${key}`, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Quota exceeded — drop this entry so we don't half-poison future reads.
    try { sessionStorage.removeItem(`cache:${key}`); } catch {}
  }
}

export function invalidateCache(key) {
  try { sessionStorage.removeItem(`cache:${key}`); } catch {}
}

// ─── Offline write queue ────────────────────────────────────────────────────
// Short offline gaps shouldn't drop paint actions. Writes that fail with a
// network error (or a transient 5xx) get queued in localStorage and replayed
// when the network returns. Last-write-wins by virtue of FIFO replay — if
// you paint A red, then A blue, the second op is sent last and sticks.

const QUEUE_KEY = "writeQueue";

function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
  catch { return []; }
}

function saveQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch {}
}

export function pendingWriteCount() {
  return loadQueue().length;
}

const queueListeners = new Set();
export function onQueueChange(cb) {
  queueListeners.add(cb);
  return () => queueListeners.delete(cb);
}
function notifyQueueChange() {
  for (const cb of queueListeners) {
    try { cb(pendingWriteCount()); } catch {}
  }
}

function enqueueWrite(op) {
  const q = loadQueue();
  q.push(op);
  saveQueue(q);
  notifyQueueChange();
}

// Internal: perform a write, queue on failure that's plausibly transient.
async function fetchWrite(method, url, hdr, body) {
  try {
    const res = await fetch(url, { method, headers: hdr, body });
    if (res.ok) return;
    // 5xx → likely transient; queue and surface success to caller so
    // the local state stays consistent. 4xx → real client error, throw.
    if (res.status >= 500) {
      enqueueWrite({ method, url, headers: hdr, body });
      return;
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    // TypeError from fetch === network error / offline.
    if (e instanceof TypeError) {
      enqueueWrite({ method, url, headers: hdr, body });
      return;
    }
    throw e;
  }
}

let draining = false;
export async function drainWriteQueue() {
  if (draining || !navigator.onLine) return;
  draining = true;
  try {
    while (true) {
      let q = loadQueue();
      if (q.length === 0) break;
      const op = q[0];
      try {
        const res = await fetch(op.url, {
          method: op.method,
          headers: op.headers,
          body: op.body
        });
        if (!res.ok) {
          if (res.status >= 500) break;          // try again later
          console.warn(`drop queued op (HTTP ${res.status})`, op);
        }
      } catch (e) {
        if (e instanceof TypeError) break;       // back offline
        console.warn("drop queued op (error)", e, op);
      }
      // Pop the head — reload first so concurrent enqueues aren't lost.
      q = loadQueue();
      q.shift();
      saveQueue(q);
      notifyQueueChange();
    }
  } finally {
    draining = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", drainWriteQueue);
  window.addEventListener("load", drainWriteQueue);
  // Periodic safety net for missed "online" events / flaky connections.
  setInterval(() => {
    if (navigator.onLine && pendingWriteCount() > 0) drainWriteQueue();
  }, 30 * 1000);
}

async function fetchAllPaged(baseUrl) {
  const sep = baseUrl.includes("?") ? "&" : "?";
  const all = [];
  let offset = 0;
  while (true) {
    const url = `${baseUrl}${sep}offset=${offset}&limit=${PAGE_SIZE}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

export async function fetchAllAnnotations() {
  return fetchAllPaged(`${SUPABASE_URL}/rest/v1/annotations?select=building_id,group_id,day,period,color,comment,is_attention,updated_at`);
}

export async function fetchAnnotations(groupId) {
  return fetchAllPaged(`${SUPABASE_URL}/rest/v1/annotations?group_id=eq.${encodeURIComponent(groupId)}&select=building_id,day,period,color,comment,is_attention,updated_at`);
}

export async function upsertAnnotation({
  building_id, group_id, day,
  period = null, color = null, comment = null,
  is_attention = false
}) {
  await fetchWrite(
    "POST",
    `${SUPABASE_URL}/rest/v1/annotations`,
    { ...headers(), "Prefer": "resolution=merge-duplicates,return=minimal" },
    JSON.stringify({ building_id, group_id, day, period, color, comment, is_attention })
  );
}

export async function fetchGroupAmount({ group_id, day, period }) {
  const url = `${SUPABASE_URL}/rest/v1/group_amounts?group_id=eq.${encodeURIComponent(group_id)}&day=eq.${day}&period=eq.${encodeURIComponent(period)}&select=amount_cents,notes`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`fetchGroupAmount failed: ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

export async function fetchAllGroupAmounts() {
  return fetchAllPaged(`${SUPABASE_URL}/rest/v1/group_amounts?select=group_id,day,period,amount_cents,notes,updated_at`);
}

export async function upsertGroupAmount({ group_id, day, period, amount_cents, notes = null }) {
  await fetchWrite(
    "POST",
    `${SUPABASE_URL}/rest/v1/group_amounts`,
    { ...headers(), "Prefer": "resolution=merge-duplicates,return=minimal" },
    JSON.stringify({ group_id, day, period, amount_cents, notes })
  );
}

export async function fetchAllAssignments() {
  // No client-side cache here: sessionStorage is per-tab, so changes
  // made in one tab (admin) stayed invisible to another tab (group view)
  // until the 60s TTL expired. Always-fresh is cheap enough.
  return fetchAllPaged(`${SUPABASE_URL}/rest/v1/building_assignments?select=building_id,group_id,is_priority,updated_at`);
}

export async function upsertAssignment({ building_id, group_id }) {
  await fetchWrite(
    "POST",
    `${SUPABASE_URL}/rest/v1/building_assignments`,
    { ...headers(), "Prefer": "resolution=merge-duplicates,return=minimal" },
    JSON.stringify({ building_id, group_id })
  );
  invalidateCache("assignments");
}

export async function deleteAssignment({ building_id }) {
  await fetchWrite(
    "DELETE",
    `${SUPABASE_URL}/rest/v1/building_assignments?building_id=eq.${encodeURIComponent(building_id)}`,
    headers(),
    undefined
  );
  invalidateCache("assignments");
}

export async function upsertAssignmentsBulk(rows) {
  if (!rows.length) return;
  await fetchWrite(
    "POST",
    `${SUPABASE_URL}/rest/v1/building_assignments`,
    { ...headers(), "Prefer": "resolution=merge-duplicates,return=minimal" },
    JSON.stringify(rows)
  );
  invalidateCache("assignments");
}

export async function deleteAssignmentsBulk(building_ids) {
  if (!building_ids.length) return;
  const inList = building_ids.map(encodeURIComponent).join(",");
  await fetchWrite(
    "DELETE",
    `${SUPABASE_URL}/rest/v1/building_assignments?building_id=in.(${inList})`,
    headers(),
    undefined
  );
  invalidateCache("assignments");
}

// PATCH the is_priority flag for a set of already-assigned buildings.
// Buildings without an assignment row are silently skipped server-side
// (the filter matches nothing).
export async function setPriorityBulk(building_ids, is_priority) {
  if (!building_ids.length) return;
  const inList = building_ids.map(encodeURIComponent).join(",");
  await fetchWrite(
    "PATCH",
    `${SUPABASE_URL}/rest/v1/building_assignments?building_id=in.(${inList})`,
    headers(),
    JSON.stringify({ is_priority })
  );
  invalidateCache("assignments");
}

export async function fetchAllGroupAccess() {
  // Same rationale as fetchAllAssignments — fresh each time.
  return fetchAllPaged(`${SUPABASE_URL}/rest/v1/group_access?select=group_id,granted_group_id`);
}

export async function upsertGroupAccess({ group_id, granted_group_id }) {
  await fetchWrite(
    "POST",
    `${SUPABASE_URL}/rest/v1/group_access`,
    { ...headers(), "Prefer": "resolution=merge-duplicates,return=minimal" },
    JSON.stringify({ group_id, granted_group_id })
  );
  invalidateCache("access");
}

export async function deleteGroupAccess({ group_id, granted_group_id }) {
  await fetchWrite(
    "DELETE",
    `${SUPABASE_URL}/rest/v1/group_access`
      + `?group_id=eq.${encodeURIComponent(group_id)}`
      + `&granted_group_id=eq.${encodeURIComponent(granted_group_id)}`,
    headers(),
    undefined
  );
  invalidateCache("access");
}

export async function deleteAnnotation({ building_id, group_id }) {
  await fetchWrite(
    "DELETE",
    `${SUPABASE_URL}/rest/v1/annotations?building_id=eq.${encodeURIComponent(building_id)}&group_id=eq.${encodeURIComponent(group_id)}`,
    headers(),
    undefined
  );
}
