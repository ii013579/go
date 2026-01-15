// map-logic.js
let map;
let geoJsonLayers = L.featureGroup();
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    map = L.map('map', { zoomControl: false, maxZoom: 25 }).setView([23.6, 120.9], 8);
    window.map = map;
    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 25, maxNativeZoom: 20 }).addTo(map);
    geoJsonLayers.addTo(map);
});

// 核心展點邏輯
window.addGeoJsonLayers = function(features) {
    geoJsonLayers.clearLayers();
    L.geoJSON(features, {
        pointToLayer: (feature, latlng) => {
            // 使用 CSS 中的 custom-dot-icon 樣式
            const marker = L.marker(latlng, {
                icon: L.divIcon({ className: 'custom-dot-icon' })
            });

            // 綁定標籤 (對應 CSS .marker-label span)
            marker.bindTooltip(`<span>${feature.properties.name || ""}</span>`, {
                permanent: true,
                direction: 'right',
                className: 'marker-label',
                offset: [10, 0]
            });

            marker.on('click', () => {
                // 點擊時移除其他高亮並高亮當前標籤
                document.querySelectorAll('.marker-label span').forEach(s => s.classList.remove('label-active'));
                const tooltip = marker.getTooltip().getElement();
                if (tooltip) tooltip.querySelector('span').classList.add('label-active');
                
                if (window.openSurveyPanel) window.openSurveyPanel(feature, latlng);
            });

            return marker;
        }
    }).addTo(geoJsonLayers);
    
    if (features.length > 0) map.fitBounds(geoJsonLayers.getBounds(), { padding: [50, 50] });
};

window.loadKmlLayerFromFirestore = async function(kmlId) {
    if (!kmlId) return;
    const doc = await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').doc(kmlId).get();
    if (doc.exists) {
        const data = doc.data();
        const geojson = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson;
        window.allKmlFeatures = geojson.features || [];
        window.currentKmlLayerId = kmlId;
        window.addGeoJsonLayers(window.allKmlFeatures);
    }
};