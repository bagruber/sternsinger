// Fetch all buildings within an OSM admin boundary via Overpass.
// Writes data/buildings.geojson. Run: node scripts/fetch-buildings.mjs
//
// AREA_RELATION_ID is the OSM relation id of the boundary. Find it via
// https://www.openstreetmap.org → search → click the boundary → URL ends in /relation/<id>.
// 29996 = Moosburg a.d. Isar (Bayern).

import { writeFile } from "node:fs/promises";

const AREA_RELATION_ID = 29996;
const AREA_LABEL = "Moosburg a.d. Isar";
const OUT = "data/buildings.geojson";

// Overpass area ids = 3_600_000_000 + relation id
const areaId = 3_600_000_000 + AREA_RELATION_ID;
const query = `
[out:json][timeout:90];
area(${areaId})->.a;
(
  way["building"](area.a);
);
out body;
>;
out skel qt;
`;

console.log(`Fetching buildings for "${AREA_LABEL}" (relation ${AREA_RELATION_ID}) from Overpass…`);
const res = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  body: "data=" + encodeURIComponent(query),
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "gebaude-marker/0.1 (https://github.com/decentbi)"
  }
});
if (!res.ok) throw new Error(`Overpass returned ${res.status}: ${await res.text()}`);
const osm = await res.json();
console.log(`Got ${osm.elements.length} OSM elements.`);

const nodes = new Map();
for (const el of osm.elements) {
  if (el.type === "node") nodes.set(el.id, [el.lon, el.lat]);
}

const features = [];
let skipped = 0;
for (const el of osm.elements) {
  if (el.type !== "way") continue;
  if (!el.tags?.building) continue;
  const coords = el.nodes.map(id => nodes.get(id)).filter(Boolean);
  if (coords.length < 4) { skipped++; continue; }
  // Ensure ring is closed.
  const first = coords[0], last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
  features.push({
    type: "Feature",
    properties: {
      id: `w${el.id}`,
      name: el.tags.name || null,
      building: el.tags.building
    },
    geometry: { type: "Polygon", coordinates: [coords] }
  });
}
// Note: building relations (multipolygons) are skipped — rare for Sternsinger use case.

const geojson = { type: "FeatureCollection", features };
await writeFile(OUT, JSON.stringify(geojson));
console.log(`Wrote ${features.length} buildings to ${OUT} (skipped ${skipped} degenerate ways).`);
