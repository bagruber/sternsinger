const map = L.map('map').setView([49.02, 12.095], 17);

// OSM Hintergrund
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19
}).addTo(map);

// gespeicherte Farben laden
const saved = JSON.parse(localStorage.getItem("colors") || "{}");

function saveColor(id, color) {
  saved[id] = color;
  localStorage.setItem("colors", JSON.stringify(saved));
}

// GeoJSON laden
fetch('buildings.geojson')
  .then(res => res.json())
  .then(data => {

    const layer = L.geoJSON(data, {
      style: feature => ({
        color: "#333",
        weight: 1,
        fillColor: saved[feature.properties.id] || "#cccccc",
        fillOpacity: 0.7
      }),

      onEachFeature: (feature, layer) => {
        layer.on('click', () => {

          const current = saved[feature.properties.id];

          // simple Farb-Logik
          const nextColor =
            current === "#ff0000" ? "#00ff00" :
            current === "#00ff00" ? "#0000ff" :
            "#ff0000";

          layer.setStyle({ fillColor: nextColor });
          saveColor(feature.properties.id, nextColor);

          // optional Kommentar (später Backend)
          const comment = prompt("Kommentar eingeben (optional):");
          if (comment) {
            console.log("Kommentar:", comment);
          }
        });
      }
    });

    layer.addTo(map);
  });
