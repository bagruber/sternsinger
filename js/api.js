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
  const url = `${SUPABASE_URL}/rest/v1/annotations?select=building_id,group_id,day,period,color,comment,tag,updated_at`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`fetchAllAnnotations failed: ${res.status}`);
  return res.json();
}

export async function fetchAnnotations(groupId) {
  const url = `${SUPABASE_URL}/rest/v1/annotations?group_id=eq.${encodeURIComponent(groupId)}&select=building_id,day,period,color,comment,tag,updated_at`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`fetchAnnotations failed: ${res.status}`);
  return res.json();
}

export async function upsertAnnotation({ building_id, group_id, day, period = null, color, comment = null, tag = null }) {
  const url = `${SUPABASE_URL}/rest/v1/annotations`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(), "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ building_id, group_id, day, period, color, comment, tag })
  });
  if (!res.ok) throw new Error(`upsertAnnotation failed: ${res.status}`);
}

export async function patchComment({ building_id, group_id, comment }) {
  const url = `${SUPABASE_URL}/rest/v1/annotations?building_id=eq.${encodeURIComponent(building_id)}&group_id=eq.${encodeURIComponent(group_id)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ comment })
  });
  if (!res.ok) throw new Error(`patchComment failed: ${res.status}`);
}

export async function deleteAnnotation({ building_id, group_id }) {
  const url = `${SUPABASE_URL}/rest/v1/annotations?building_id=eq.${encodeURIComponent(building_id)}&group_id=eq.${encodeURIComponent(group_id)}`;
  const res = await fetch(url, { method: "DELETE", headers: headers() });
  if (!res.ok) throw new Error(`deleteAnnotation failed: ${res.status}`);
}
