// js/map-util.js — shared map helpers.

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
