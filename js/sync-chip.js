// js/sync-chip.js — tiny shared status chip for the offline write queue.
//
// Hidden when online and queue is empty. Otherwise shows a count + state:
//   - state="offline":  no network connection
//   - state="syncing":  online but pending writes haven't flushed yet
// Tap to force a drain (no-op offline).

import { pendingWriteCount, onQueueChange, drainWriteQueue } from "./api.js";

export function setupSyncChip(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const countEl = el.querySelector(".sync-count");

  function render() {
    const n = pendingWriteCount();
    const online = navigator.onLine;
    if (n === 0 && online) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    el.dataset.state = online ? "syncing" : "offline";
    if (countEl) countEl.textContent = n > 0 ? String(n) : "";
    el.title = online
      ? (n > 0 ? `Synchronisiere ${n} Änderung${n === 1 ? "" : "en"} …` : "Online")
      : (n > 0
          ? `Offline — ${n} Änderung${n === 1 ? "" : "en"} wartet`
          : "Offline");
  }

  el.addEventListener("click", () => { if (navigator.onLine) drainWriteQueue(); });
  onQueueChange(render);
  window.addEventListener("online", render);
  window.addEventListener("offline", render);
  render();
}
