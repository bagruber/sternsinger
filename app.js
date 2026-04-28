import { generateBuildings } from './generateBuildings.js';

const map = L.map('map').setView([48.47, 11.937], 18);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let mode = "brush";
let history = [];

const cursor = document.getElementById("cursor");

window.setMode = (m) => {
  mode = m;
};

window.undo = () => {
  const last = history.pop();
  if (!last) return;

  last.layer.setStyle({ fillColor: last.prev });
};

const saved = {};

function paint(feature, layer, color) {
  const prev = layer.options.fillColor;

  history.push({ layer, prev });

  layer.setStyle({ fillColor: color, fillOpacity: 0.9 });

  setTimeout(() => {
    layer.setStyle({ fillOpacity: 0.7 });
  }, 100);

  if (navigator.vibrate) navigator.vibrate(10);
}

const data = generateBuildings(600);

const geoLayer = L.geoJSON(data, {
  style: () => ({
    color: "#333",
    weight: 1,
    fillColor: "#ccc",
    fillOpacity: 0.7
  }),

  onEachFeature: (feature, layer) => {

    let pressTimer;

    layer.on('touchstart', (e) => {
      pressTimer = setTimeout(() => {
        const text = prompt("Kommentar:");
        console.log("Kommentar", feature.properties.id, text);
      }, 500);
    });

    layer.on('touchend', () => {
      clearTimeout(pressTimer);
    });

    layer.on('click', () => {
      if (mode === "single") {
        const current = layer.options.fillColor;
        const next = current === "#ff0000" ? "#ccc" : "#ff0000";
        paint(feature, layer, next);
      }
    });
  }
}).addTo(map);

// 🔥 PAINT MODE
map.on('touchmove', (e) => {

  cursor.style.left = e.originalEvent.touches[0].clientX + "px";
  cursor.style.top = e.originalEvent.touches[0].clientY + "px";

  if (mode !== "brush" && mode !== "erase") return;

  const latlng = map.containerPointToLatLng(e.containerPoint);

  geoLayer.eachLayer(layer => {
    if (layer.getBounds().contains(latlng)) {

      if (mode === "brush") {
        paint(layer.feature, layer, "#ff0000");
      }

      if (mode === "erase") {
        paint(layer.feature, layer, "#ccc");
      }
    }
  });
});

// scroll verhindern
map.getContainer().addEventListener('touchmove', e => {
  if (mode === "brush" || mode === "erase") {
    e.preventDefault();
  }
}, { passive: false });
