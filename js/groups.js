// js/groups.js — shared group definitions.

export const GROUPS = [
  { id: "Stadt",            color: "#e74c3c" },
  { id: "Feldkirchner Au",  color: "#e67e22" },
  { id: "Neustadt I",       color: "#f1c40f" },
  { id: "Neustadt II",      color: "#2ecc71" },
  { id: "Bonau",            color: "#1abc9c" },
  { id: "Westerberg",       color: "#3498db" },
  { id: "Oberes Gereuth",   color: "#9b59b6" },
  { id: "Unteres Gereuth",  color: "#e91e63" }
];

export const GROUP_NAMES = GROUPS.map(g => g.id);

export const GROUP_COLOR = Object.fromEntries(GROUPS.map(g => [g.id, g.color]));
