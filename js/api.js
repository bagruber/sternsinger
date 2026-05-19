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
  return fetchAllPaged(`${SUPABASE_URL}/rest/v1/annotations?select=building_id,group_id,day,period,color,comment,is_attention,is_important,updated_at`);
}

export async function fetchAnnotations(groupId) {
  return fetchAllPaged(`${SUPABASE_URL}/rest/v1/annotations?group_id=eq.${encodeURIComponent(groupId)}&select=building_id,day,period,color,comment,is_attention,is_important,updated_at`);
}

export async function upsertAnnotation({
  building_id, group_id, day,
  period = null, color = null, comment = null,
  is_attention = false, is_important = false
}) {
  const url = `${SUPABASE_URL}/rest/v1/annotations`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(), "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ building_id, group_id, day, period, color, comment, is_attention, is_important })
  });
  if (!res.ok) throw new Error(`upsertAnnotation failed: ${res.status}`);
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
  const url = `${SUPABASE_URL}/rest/v1/group_amounts`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(), "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ group_id, day, period, amount_cents, notes })
  });
  if (!res.ok) throw new Error(`upsertGroupAmount failed: ${res.status}`);
}

export async function fetchAllAssignments() {
  return fetchAllPaged(`${SUPABASE_URL}/rest/v1/building_assignments?select=building_id,group_id,updated_at`);
}

export async function upsertAssignment({ building_id, group_id }) {
  const url = `${SUPABASE_URL}/rest/v1/building_assignments`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(), "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ building_id, group_id })
  });
  if (!res.ok) throw new Error(`upsertAssignment failed: ${res.status}`);
}

export async function deleteAssignment({ building_id }) {
  const url = `${SUPABASE_URL}/rest/v1/building_assignments?building_id=eq.${encodeURIComponent(building_id)}`;
  const res = await fetch(url, { method: "DELETE", headers: headers() });
  if (!res.ok) throw new Error(`deleteAssignment failed: ${res.status}`);
}

export async function upsertAssignmentsBulk(rows) {
  if (!rows.length) return;
  const url = `${SUPABASE_URL}/rest/v1/building_assignments`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(), "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error(`upsertAssignmentsBulk failed: ${res.status}`);
}

export async function deleteAssignmentsBulk(building_ids) {
  if (!building_ids.length) return;
  const inList = building_ids.map(encodeURIComponent).join(",");
  const url = `${SUPABASE_URL}/rest/v1/building_assignments?building_id=in.(${inList})`;
  const res = await fetch(url, { method: "DELETE", headers: headers() });
  if (!res.ok) throw new Error(`deleteAssignmentsBulk failed: ${res.status}`);
}

export async function fetchAllGroupAccess() {
  return fetchAllPaged(`${SUPABASE_URL}/rest/v1/group_access?select=group_id,granted_group_id`);
}

export async function upsertGroupAccess({ group_id, granted_group_id }) {
  const url = `${SUPABASE_URL}/rest/v1/group_access`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(), "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ group_id, granted_group_id })
  });
  if (!res.ok) throw new Error(`upsertGroupAccess failed: ${res.status}`);
}

export async function deleteGroupAccess({ group_id, granted_group_id }) {
  const url = `${SUPABASE_URL}/rest/v1/group_access`
    + `?group_id=eq.${encodeURIComponent(group_id)}`
    + `&granted_group_id=eq.${encodeURIComponent(granted_group_id)}`;
  const res = await fetch(url, { method: "DELETE", headers: headers() });
  if (!res.ok) throw new Error(`deleteGroupAccess failed: ${res.status}`);
}

export async function deleteAnnotation({ building_id, group_id }) {
  const url = `${SUPABASE_URL}/rest/v1/annotations?building_id=eq.${encodeURIComponent(building_id)}&group_id=eq.${encodeURIComponent(group_id)}`;
  const res = await fetch(url, { method: "DELETE", headers: headers() });
  if (!res.ok) throw new Error(`deleteAnnotation failed: ${res.status}`);
}
