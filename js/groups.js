// js/groups.js — shared domain constants.

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

export const DAYS = [
  { n: 1, color: "#e74c3c", label: "Tag 1" },
  { n: 2, color: "#e67e22", label: "Tag 2" },
  { n: 3, color: "#2ecc71", label: "Tag 3" },
  { n: 4, color: "#3498db", label: "Tag 4" }
];

export const PERIODS = [
  { id: "morning",   label: "Vor Mittag",  short: "VM" },
  { id: "afternoon", label: "Nach Mittag", short: "NM" }
];
