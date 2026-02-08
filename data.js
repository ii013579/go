import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

window.renderGeoJson = (features) => {
    window.App.markers.clearLayers();
    window.App.geoJsonLayers.clearLayers();
    features.forEach(f => {
        if (f.geometry.type === 'Point') {
            const m = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]]);
            m.bindPopup(`<b>${f.properties.name || '未命名'}</b>`);
            window.App.markers.addLayer(m);
        } else {import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

window.addGeoJsonLayers = (features) => {
    window.App.markers.clearLayers();
    window.App.geoJsonLayers.clearLayers();
    features.forEach(f => {
        if (f.geometry.type === 'Point') {
            const marker = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]]);
            marker.bindPopup(`<b>${f.properties.name || '未命名'}</b>`);
            window.App.markers.addLayer(marker);
        } else {
            window.App.geoJsonLayers.addLayer(L.geoJSON(f));
        }
    });
    const bounds = L.featureGroup([window.App.markers, window.App.geoJsonLayers]).getBounds();
    if (bounds.isValid()) window.App.map.fitBounds(bounds, { padding: [50, 50] });
};

window.loadKml = async (id) => {
    if (!id || window.App.isLoading) return;
    window.App.isLoading = true;
    try {
        const snap = await getDoc(doc(window.db, `apps/${window.appId}/kmlLayers`, id));
        if (snap.exists()) {
            let geo = snap.data().geojson;
            if (typeof geo === 'string') geo = JSON.parse(geo);
            window.App.allKmlFeatures = geo.features.filter(f => f.geometry && f.properties);
            window.addGeoJsonLayers(window.App.allKmlFeatures);
        }
    } finally { window.App.isLoading = false; }
};

window.updateKmlSelect = async () => {
    const snap = await getDocs(collection(window.db, `apps/${window.appId}/kmlLayers`));
    const select = document.getElementById('kmlLayerSelect');
    if (!select) return;
    select.innerHTML = '<option value="">請選擇圖層</option>';
    snap.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.data().name;
        select.appendChild(opt);
    });
};
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