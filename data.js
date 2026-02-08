// data.js - 修正第 11 行語法錯誤
import { 
    doc, 
    getDoc, 
    collection, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// 1. 恢復 v1.9.6 的 GeoJSON 渲染邏輯
window.addGeoJsonLayers = function(features) {
    if (!window.App.map) return;

    // 清除舊圖層
    window.App.markers.clearLayers();
    window.App.geoJsonLayers.clearLayers();

    features.forEach(f => {
        if (f.geometry && f.geometry.type === 'Point') {
            const lat = f.geometry.coordinates[1];
            const lng = f.geometry.coordinates[0];
            const marker = L.marker([lat, lng]);
            
            // 恢復彈窗資訊
            if (f.properties && f.properties.name) {
                marker.bindPopup(`<b>${f.properties.name}</b>`);
            }
            window.App.markers.addLayer(marker);
        } else {
            // 處理 LineString 或 Polygon
            window.App.geoJsonLayers.addLayer(L.geoJSON(f));
        }
    });

    // 恢復 v1.9.6 的 fitBounds 邏輯 (50x50 padding)
    const allLayers = L.featureGroup([window.App.markers, window.App.geoJsonLayers]);
    const bounds = allLayers.getBounds();
    if (bounds.isValid()) {
        window.App.map.fitBounds(bounds, { padding: [50, 50] });
    }
};

// 2. 恢復 v1.9.6 的 KML 載入邏輯 (從 Firestore 讀取)
window.loadKml = async function(kmlId) {
    if (!kmlId || window.App.isLoadingKml) return;
    window.App.isLoadingKml = true;

    try {
        // 使用 window.db 與 window.appId (由 init.js 提供)
        const docRef = doc(window.db, `apps/${window.appId}/kmlLayers`, kmlId);
        const snap = await getDoc(docRef);

        if (snap.exists()) {
            const data = snap.data();
            let geojson = data.geojson;

            // 處理字串格式的 JSON
            if (typeof geojson === 'string') {
                geojson = JSON.parse(geojson);
            }

            const features = (geojson.features || []).filter(f => f.geometry && f.properties);
            window.App.allKmlFeatures = features;
            
            // 呼叫渲染
            window.addGeoJsonLayers(features);
        } else {
            console.error("找不到該 KML 圖層");
        }
    } catch (error) {
        console.error("載入失敗:", error);
        if (window.showMessage) window.showMessage("錯誤", "無法讀取資料庫: " + error.message);
    } finally {
        window.App.isLoadingKml = false;
    }
};

// 3. 恢復 v1.9.6 的下拉選單更新
window.updateKmlSelect = async function() {
    const select = document.getElementById('kmlLayerSelect');
    if (!select) return;

    try {
        const colRef = collection(window.db, `apps/${window.appId}/kmlLayers`);
        const snap = await getDocs(colRef);
        
        select.innerHTML = '<option value="">請選擇圖層</option>';
        snap.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = d.data().name || d.id;
            select.appendChild(opt);
        });
    } catch (error) {
        console.error("更新選單失敗:", error);
    }
};