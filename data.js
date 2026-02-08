import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

window.renderGeoJson = (features) => {
    window.App.markers.clearLayers();
    window.App.geoJsonLayers.clearLayers();
    features.forEach(f => {
        if (f.geometry.type === 'Point') {
            const m = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]]);
            m.bindPopup(`<b>${f.properties.name || '未命名'}</b>`);
            window.App.markers.addLayer(m);
        } else {
            window.App.geoJsonLayers.addLayer(L.geoJSON(f));
        }
    });
    const bounds = L.featureGroup([window.App.markers, window.App.geoJsonLayers]).getBounds();
    if (bounds.isValid()) window.App.map.fitBounds(bounds, { padding: [50, 50] });
};

window.loadKml = async (id) => {
    if (!id) return;
    const snap = await getDoc(doc(window.db, `apps/${window.appId}/kmlLayers`, id));
    if (snap.exists()) {
        const data = snap.data();
        window.App.allFeatures = (typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson).features;
        window.renderGeoJson(window.App.allFeatures);
    }
};