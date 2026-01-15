// map-logic.js v2.0.0 (還原 1.9.6 展點樣式)
let map;
let geoJsonLayers = L.featureGroup();
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    // 初始化地圖
    map = L.map('map', { zoomControl: false, maxZoom: 25 }).setView([23.6, 120.9], 8);
    window.map = map;
    
    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 25,
        maxNativeZoom: 20
    }).addTo(map);
    
    geoJsonLayers.addTo(map);
});

// 負責將 GeoJSON 資料渲染至地圖
window.addGeoJsonLayers = function(features) {
    geoJsonLayers.clearLayers();
    
    L.geoJSON(features, {
        pointToLayer: (feature, latlng) => {
            // 完全還原 image_953d72.png 的橘紅點樣式
            const marker = L.circleMarker(latlng, {
                radius: 8,
                fillColor: "#ff7800", // 1.9.6 標準橘紅
                color: "#000",        // 黑色外框
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });

            // 綁定 v1.9.6 標籤樣式
            marker.bindTooltip(feature.properties.name || "", { 
                permanent: true, 
                direction: 'right', 
                className: 'marker-label-v196' 
            });

            // 點擊觸發清查面板
            marker.on('click', () => {
                if (window.openSurveyPanel) window.openSurveyPanel(feature, latlng);
            });

            return marker;
        }
    }).addTo(geoJsonLayers);

    if (geoJsonLayers.getLayers().length > 0) {
        map.fitBounds(geoJsonLayers.getBounds(), { padding: [50, 50] });
    }
};

// 負責從 Firestore 獲取圖層資料並呼叫展點
window.loadKmlLayerFromFirestore = async function(kmlId) {
    if (!kmlId) return;
    window.currentKmlLayerId = kmlId;
    
    try {
        const doc = await window.db.collection('artifacts').doc(window.appId)
            .collection('public').doc('data').collection('kmlLayers').doc(kmlId).get();
        
        if (doc.exists) {
            const data = doc.data();
            const geojson = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson;
            window.allKmlFeatures = geojson.features || [];
            window.addGeoJsonLayers(window.allKmlFeatures);
        }
    } catch (err) {
        console.error("載入圖層失敗:", err);
    }
};