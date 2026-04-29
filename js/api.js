// js/api.js — Supabase REST client.

const SUPABASE_URL = "https://kgrmlzlagahsjpsgatoc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8xrpeD4PUXFRBlz9n6g9NQ_2DULIHpV";

const headers = () => ({
  "Content-Type": "application/json",
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  "Prefer": "return=minimal"
});

export async function fetchAllAnnotations() {
  const url = `${SUPABASE_URL}/rest/v1/annotations?select=building_id,group_id,day,period,color,comment,is_attention,is_important,updated_at`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`fetchAllAnnotations failed: ${res.status}`);
  return res.json();
}

export async function fetchAnnotations(groupId) {
  const url = `${SUPABASE_URL}/rest/v1/annotations?group_id=eq.${encodeURIComponent(groupId)}&select=building_id,day,period,color,comment,is_attention,is_important,updated_at`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`fetchAnnotations failed: ${res.status}`);
  return res.json();
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
  const url = `${SUPABASE_URL}/rest/v1/group_amounts?select=group_id,day,period,amount_cents,notes,updated_at`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`fetchAllGroupAmounts failed: ${res.status}`);
  return res.json();
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

export async function deleteAnnotation({ building_id, group_id }) {
  const url = `${SUPABASE_URL}/rest/v1/annotations?building_id=eq.${encodeURIComponent(building_id)}&group_id=eq.${encodeURIComponent(group_id)}`;
  const res = await fetch(url, { method: "DELETE", headers: headers() });
  if (!res.ok) throw new Error(`deleteAnnotation failed: ${res.status}`);
}
