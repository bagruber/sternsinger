// js/brush.js — shared touch/mouse brush wiring for paint/erase on a Leaflet map.
//
// Both the group app and the admin view need the same gesture handling:
//   - 1-finger drag paints/erases under the cursor (with a circular brush)
//   - 2-finger touch falls back to map panning
//   - Below MIN_ZOOM, painting is blocked
//   - Strokes dedupe so a building under the brush is only invoked once
//   - Stroke end fires a callback (used by callers to flush pending writes)
//
// Caller supplies:
//   - getMode():  returns the active mode string. Brush is active iff "brush" or "erase".
//   - onPaint(id) / onErase(id):  called once per building per stroke.
//   - onStrokeEnd():  optional — runs on touchend/touchcancel/mouseup after each stroke.
//   - onZoomBlocked(zoom, minZoom):  optional — called when the user tries to start
//     a stroke below MIN_ZOOM. Useful for surfacing a toast.

import { buildingsNearPoint } from "./map-util.js";

export function setupBrush(map, {
  getMode,
  onPaint,
  onErase,
  onStrokeEnd,
  layersById,
  minZoom,
  radiusPx,
  onZoomBlocked,
}) {
  const mapEl = map.getContainer();
  let isPainting = false;
  let touchedThisStroke = new Set();

  function isBrushMode() {
    const m = getMode();
    return m === "brush" || m === "erase";
  }

  function clientToContainerPoint(t) {
    const r = mapEl.getBoundingClientRect();
    return L.point(t.clientX - r.left, t.clientY - r.top);
  }

  function dispatch(id) {
    if (touchedThisStroke.has(id)) return;
    touchedThisStroke.add(id);
    const mode = getMode();
    if (mode === "brush") onPaint?.(id);
    else if (mode === "erase") onErase?.(id);
  }

  function paintAtPoint(containerPoint) {
    const ids = buildingsNearPoint(map, layersById, containerPoint, radiusPx);
    ids.forEach(dispatch);
  }

  function beginStroke(point) {
    isPainting = true;
    touchedThisStroke = new Set();
    paintAtPoint(point);
  }

  function endStroke() {
    if (!isPainting) return;
    isPainting = false;
    onStrokeEnd?.();
  }

  // ─── Touch ───
  mapEl.addEventListener("touchstart", (e) => {
    if (!isBrushMode()) return;
    if (e.touches.length >= 2) { map.dragging.enable(); isPainting = false; return; }
    if (map.getZoom() < minZoom) { onZoomBlocked?.(map.getZoom(), minZoom); return; }
    e.preventDefault();
    map.dragging.disable();
    beginStroke(clientToContainerPoint(e.touches[0]));
  }, { passive: false });

  mapEl.addEventListener("touchmove", (e) => {
    if (!isBrushMode()) return;
    if (e.touches.length >= 2) { isPainting = false; map.dragging.enable(); return; }
    if (!isPainting) return;
    e.preventDefault();
    paintAtPoint(clientToContainerPoint(e.touches[0]));
  }, { passive: false });

  mapEl.addEventListener("touchend",    endStroke, { passive: false });
  mapEl.addEventListener("touchcancel", endStroke, { passive: false });

  // ─── Mouse (desktop) ───
  mapEl.addEventListener("mousedown", (e) => {
    if (!isBrushMode()) return;
    if (map.getZoom() < minZoom) { onZoomBlocked?.(map.getZoom(), minZoom); return; }
    const r = mapEl.getBoundingClientRect();
    beginStroke(L.point(e.clientX - r.left, e.clientY - r.top));
  });
  mapEl.addEventListener("mousemove", (e) => {
    if (!isPainting || !isBrushMode()) return;
    const r = mapEl.getBoundingClientRect();
    paintAtPoint(L.point(e.clientX - r.left, e.clientY - r.top));
  });
  window.addEventListener("mouseup", endStroke);

  return {
    // Call after a mode change so map dragging reflects the new mode.
    refreshDragPolicy() {
      if (isBrushMode()) map.dragging.disable();
      else map.dragging.enable();
    }
  };
}
