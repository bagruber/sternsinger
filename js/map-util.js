// js/map-util.js — shared map helpers.

// ─── Viewport culling ───────────────────────────────────────────────────────
// Rendering all ~5000 building polygons up-front pegs the main thread for
// ~1s on each page load and slows panning. createCuller only adds layers
// for buildings whose bbox intersects a padded version of the viewport,
// and adds/removes layers as the user pans/zooms.
//
// Hard cap (maxLayers) keeps low-zoom views responsive: when too many
// buildings would land in the padded bounds, we fall back to the N
// closest-to-centre, so the user's focus area stays detailed.
export function createCuller(map, {
  features,         // [{ id, feature }]  GeoJSON Feature wrappers
  layersById,       // Map<id, leaflet layer> — mutated in place
  layerGroup,       // L.layerGroup to add/remove from
  styleFor,         // (id) => leaflet style object
  onLayerCreated,   // (id, layer) => void; optional — handlers, tooltips
  padFactor = 0.3,  // viewport buffer; pad(0.3) = ~1.6× linear, ~2.6× area
  maxLayers = 1000,
  debounceMs = 60,
}) {
  // Precompute bbox + Leaflet latlngs once. Feature data is immutable.
  const indexed = features.map(({ id, feature }) => ({
    id,
    feature,
    bbox: computeBBox(feature.geometry),
    latlngs: geometryToLatLngs(feature.geometry),
  }));

  let timer = null;

  function cull() {
    timer = null;
    const visible = map.getBounds();
    const padded  = visible.pad(padFactor);

    // Two-pass: anything actually inside the viewport renders
    // unconditionally; the buffer ring around it fills in only up to
    // maxLayers. This way zooming out still paints the whole visible
    // area — the cap protects panning headroom, not the viewport itself.
    const inVisible = [];
    const inBuffer  = [];
    for (const f of indexed) {
      if (bboxIntersects(f.bbox, visible)) {
        inVisible.push(f);
      } else if (bboxIntersects(f.bbox, padded)) {
        inBuffer.push(f);
      }
    }

    let target = inVisible;
    const remaining = Math.max(0, maxLayers - inVisible.length);
    if (remaining > 0 && inBuffer.length > 0) {
      if (inBuffer.length > remaining) {
        const c = map.getCenter();
        inBuffer.sort((a, b) =>
          squaredCenterDist(a.bbox, c) - squaredCenterDist(b.bbox, c)
        );
        target = target.concat(inBuffer.slice(0, remaining));
      } else {
        target = target.concat(inBuffer);
      }
    }

    const wanted = new Set(target.map(f => f.id));

    // Remove layers that fell out of view.
    for (const [id, layer] of layersById) {
      if (!wanted.has(id)) {
        layerGroup.removeLayer(layer);
        layersById.delete(id);
      }
    }
    // Add newly visible layers.
    for (const f of target) {
      if (layersById.has(f.id)) continue;
      const layer = L.polygon(f.latlngs, styleFor(f.id));
      layer.feature = f.feature;     // preserve GeoJSON convention
      layersById.set(f.id, layer);
      layerGroup.addLayer(layer);
      onLayerCreated?.(f.id, layer);
    }
  }

  function scheduleCull() {
    if (timer) return;
    timer = setTimeout(cull, debounceMs);
  }

  map.on("moveend zoomend", scheduleCull);
  cull();   // initial render

  return {
    cull,
    // Re-apply the latest style to every currently-rendered layer.
    // Call after annotations/assignments reload.
    refresh() {
      for (const [id, layer] of layersById) {
        layer.setStyle(styleFor(id));
      }
    },
    teardown() {
      map.off("moveend zoomend", scheduleCull);
    },
  };
}

function computeBBox(geometry) {
  let n = -Infinity, s = Infinity, e = -Infinity, w = Infinity;
  const visit = (ring) => {
    for (const [lng, lat] of ring) {
      if (lat > n) n = lat;
      if (lat < s) s = lat;
      if (lng > e) e = lng;
      if (lng < w) w = lng;
    }
  };
  if (geometry.type === "Polygon") {
    visit(geometry.coordinates[0]);
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates) visit(poly[0]);
  }
  return { n, s, e, w };
}

function geometryToLatLngs(geometry) {
  const swap = (ring) => ring.map(([lng, lat]) => [lat, lng]);
  if (geometry.type === "Polygon")      return geometry.coordinates.map(swap);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.map(poly => poly.map(swap));
  return [];
}

function bboxIntersects(bbox, leafletBounds) {
  return !(bbox.e < leafletBounds.getWest()  ||
           bbox.w > leafletBounds.getEast()  ||
           bbox.n < leafletBounds.getSouth() ||
           bbox.s > leafletBounds.getNorth());
}

function squaredCenterDist(bbox, center) {
  const cx = (bbox.e + bbox.w) / 2;
  const cy = (bbox.n + bbox.s) / 2;
  const dx = cx - center.lng;
  const dy = cy - center.lat;
  return dx * dx + dy * dy;
}

// ─── Brush hit testing ──────────────────────────────────────────────────────
// Find buildings whose pixel-space bounding box intersects a circle of
// `radiusPx` around `containerPoint`. More forgiving than centroid-only
// distance, especially for elongated buildings.
export function buildingsNearPoint(map, layersById, containerPoint, radiusPx) {
  const hits = [];
  const mapBounds = map.getBounds();
  const r2 = radiusPx * radiusPx;
  layersById.forEach((layer, id) => {
    const bb = layer.getBounds();
    if (!mapBounds.intersects(bb)) return;
    const nw = map.latLngToContainerPoint(bb.getNorthWest());
    const se = map.latLngToContainerPoint(bb.getSouthEast());
    const minX = Math.min(nw.x, se.x);
    const maxX = Math.max(nw.x, se.x);
    const minY = Math.min(nw.y, se.y);
    const maxY = Math.max(nw.y, se.y);
    const cx = Math.max(minX, Math.min(containerPoint.x, maxX));
    const cy = Math.max(minY, Math.min(containerPoint.y, maxY));
    const dx = cx - containerPoint.x;
    const dy = cy - containerPoint.y;
    if (dx * dx + dy * dy <= r2) hits.push(id);
  });
  return hits;
}
