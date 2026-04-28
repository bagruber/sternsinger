export function generateBuildings(count = 500) {
  const center = {
    lat: 48.47,
    lng: 11.937
  };

  const buildings = [];
  const gridSize = Math.ceil(Math.sqrt(count));

  const spacing = 0.00015; // Abstand zwischen Gebäuden
  const size = 0.00008;    // Gebäudegröße

  let id = 1;

  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {

      if (id > count) break;

      // leichte Zufälligkeit für realistischere Verteilung
      const jitterLat = (Math.random() - 0.5) * 0.00005;
      const jitterLng = (Math.random() - 0.5) * 0.00005;

      const baseLat = center.lat + (x - gridSize/2) * spacing + jitterLat;
      const baseLng = center.lng + (y - gridSize/2) * spacing + jitterLng;

      const polygon = [
        [baseLng, baseLat],
        [baseLng + size, baseLat],
        [baseLng + size, baseLat + size],
        [baseLng, baseLat + size],
        [baseLng, baseLat]
      ];

      buildings.push({
        type: "Feature",
        properties: { id: "b" + id },
        geometry: {
          type: "Polygon",
          coordinates: [polygon]
        }
      });

      id++;
    }
  }

  return {
    type: "FeatureCollection",
    features: buildings
  };
}
