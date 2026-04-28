const map = L.map('map').setView([48.47, 11.937], 18);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19
}).addTo(map);

// Zustände
let mode = "brush"; // brush | erase | single | comment

const saved = JSON.parse(localStorage.getItem("colors") || {});

function saveColor(id, color) {
  saved[id] = color;
  localStorage.setItem("colors", JSON.stringify(saved));
}

// UI Buttons
const controls = L.control({ position: 'topright' });

controls.onAdd = function () {
  const div = L.DomUtil.create('div', 'controls');

  div.innerHTML = `
    <button onclick="setMode('brush')">🟢</button>
    <button onclick="setMode('erase')">⚪</button>
    <button onclick="setMode('single')">☝️</button>
    <button onclick="setMode('comment')">💬</button>
  `;
  return div;
};

controls.addTo(map);

window.setMode = (m) => {
  mode = m;
  console.log("Mode:", mode);
};

// GeoJSON
fetch('buildings.geojson')
  .then(res => res.json())
  .then(data => {

    const geoLayer = L.geoJSON(data, {
      style: feature => ({
        color: "#333",
        weight: 1,
        fillColor: saved[feature.properties.id] || "#cccccc",
        fillOpacity: 0.7
      }),

      onEachFeature: (feature, layer) => {

        // TAP (Einzelauswahl / Kommentar)
        layer.on('click', () => {

          if (mode === "single") {
            toggle(feature, layer);
          }

          if (mode === "comment") {
            const text = prompt("Kommentar:");
            if (text) {
              console.log("Kommentar für", feature.properties.id, text);
            }
          }
        });
      }
    }).addTo(map);

    // 🔥 TOUCH PAINTING
    map.on('touchmove', function (e) {

      if (mode !== "brush" && mode !== "erase") return;

      const point = e.containerPoint;
      const latlng = map.containerPointToLatLng(point);

      geoLayer.eachLayer(layer => {
        if (layer.getBounds().contains(latlng)) {
          paint(layer.feature, layer);
        }
      });
    });

    function paint(feature, layer) {
      if (mode === "brush") {
        layer.setStyle({ fillColor: "#ff0000" });
        saveColor(feature.properties.id, "#ff0000");
      }

      if (mode === "erase") {
        layer.setStyle({ fillColor: "#cccccc" });
        saveColor(feature.properties.id, "#cccccc");
      }
    }

    function toggle(feature, layer) {
      const current = saved[feature.properties.id];

      const next = current === "#ff0000" ? "#cccccc" : "#ff0000";

      layer.setStyle({ fillColor: next });
      saveColor(feature.properties.id, next);
    }
  });
