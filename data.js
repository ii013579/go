import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// 對接 Rules 路徑
const DB_PATH = `artifacts/kmldata-d22fb/public/data/kmlLayers`;

window.addGeoJsonLayers = (features) => {
    window.App.markers.clearLayers();
    window.App.geoJsonLayers.clearLayers();
    features.forEach(f => {
        if (f.geometry.type === 'Point') {
            const m = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]]);
            m.bindPopup(`<b>${f.properties.name || '無名稱'}</b>`);
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
    try {
        const snap = await getDoc(doc(window.db, DB_PATH, id));
        if (snap.exists()) {
            const data = snap.data();
            // 對接 Rules 中的 geojsonContent 欄位
            let geo = data.geojsonContent || data.geojson;
            if (typeof geo === 'string') geo = JSON.parse(geo);
            const features = geo.features || geo;
            window.App.allKmlFeatures = features;
            window.addGeoJsonLayers(features);
        }
    } catch (e) { console.error("Load Error:", e); }
};

window.updateKmlSelect = async () => {
    try {
        const snap = await getDocs(collection(window.db, DB_PATH));
        const sel = document.getElementById('kmlLayerSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">請選擇圖層</option>';
        snap.forEach(d => sel.add(new Option(d.data().name || d.id, d.id)));
    } catch (e) { console.warn("Guest Access:", e.message); }
};