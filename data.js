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

// 恢復 v1.9.6 的 GeoJSON 渲染邏輯
window.addGeoJsonLayers = (features) => {
    window.App.markers.clearLayers();
    window.App.geoJsonLayers.clearLayers();
    features.forEach(f => {
        if (f.geometry && f.geometry.type === 'Point') {
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

// 恢復 v1.9.6 的 KML 載入邏輯
window.loadKml = async (kmlId) => {
    if (!kmlId || window.App.isLoadingKml) return;
    window.App.isLoadingKml = true;
    try {
        const docRef = doc(window.db, `apps/${window.appId}/kmlLayers`, kmlId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            let geo = snap.data().geojson;
            if (typeof geo === 'string') geo = JSON.parse(geo);
            const features = (geo.features || []).filter(f => f.geometry && f.properties);
            window.App.allKmlFeatures = features;
            window.addGeoJsonLayers(features);
        }
    } catch (e) {
        console.error("資料讀取失敗:", e);
        window.showMessage("錯誤", "無法讀取資料庫圖層: " + e.message);
    } finally { window.App.isLoadingKml = false; }
};

// 刷新下拉選單
window.updateKmlSelect = async () => {
    const colRef = collection(window.db, `apps/${window.appId}/kmlLayers`);
    const snap = await getDocs(colRef);
    const select = document.getElementById('kmlLayerSelect');
    if (!select) return;
    select.innerHTML = '<option value="">請選擇圖層</option>';
    snap.forEach(d => {
        const opt = new Option(d.data().name || d.id, d.id);
        select.add(opt);
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