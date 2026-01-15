// map-logic.js
let map;
let geoJsonLayers = L.featureGroup();
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    // 初始化地圖
    map = L.map('map', { 
        zoomControl: false, 
        maxZoom: 25,
        attributionControl: true 
    }).setView([23.6, 120.9], 8);
    
    window.map = map;

    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 25,
        maxNativeZoom: 20
    }).addTo(map);

    geoJsonLayers.addTo(map);
});

// 核心功能：將資料展現於地圖
window.addGeoJsonLayers = function(features) {
    geoJsonLayers.clearLayers();

    L.geoJSON(features, {
        pointToLayer: (feature, latlng) => {
            // 使用 CSS 中的 .custom-dot-icon 樣式 (紅點)
            const marker = L.marker(latlng, {
                icon: L.divIcon({
                    className: 'custom-dot-icon',
                    iconSize: [5, 5],
                    iconAnchor: [5, 5]
                })
            });

            // 綁定 CSS 中的 .marker-label (文字標籤)
            marker.bindTooltip(`<span>${feature.properties.name || ""}</span>`, {
                permanent: true,
                direction: 'right',
                className: 'marker-label',
                offset: [10, 0]
            });

            // 點擊事件：高亮標籤並開啟清查面板
            marker.on('click', () => {
                // 移除其他點的高亮
                document.querySelectorAll('.marker-label span').forEach(el => el.classList.remove('label-active'));
                
                // 高亮當前點 (對應 CSS .label-active)
                const tooltip = marker.getTooltip().getElement();
                if (tooltip) {
                    tooltip.querySelector('span').classList.add('label-active');
                }

                if (window.openSurveyPanel) {
                    window.openSurveyPanel(feature, latlng);
                }
            });

            return marker;
        }
    }).addTo(geoJsonLayers);

    if (features.length > 0) {
        map.fitBounds(geoJsonLayers.getBounds(), { padding: [50, 50] });
    }
};

// 從 Firestore 載入圖層
window.loadKmlLayerFromFirestore = async function(kmlId) {
    if (!kmlId) return;
    try {
        const doc = await window.db.collection('artifacts').doc(window.appId)
            .collection('public').doc('data').collection('kmlLayers').doc(kmlId).get();

        if (doc.exists) {
            const data = doc.data();
            const geojson = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson;
            window.allKmlFeatures = geojson.features || [];
            window.currentKmlLayerId = kmlId;
            window.addGeoJsonLayers(window.allKmlFeatures);
        }
    } catch (err) {
        console.error("載入圖層失敗:", err);
    }
};