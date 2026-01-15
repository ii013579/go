// map-logic.js v2.0.0
let map;
let geoJsonLayers = L.featureGroup();
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    map = L.map('map', { maxZoom: 25, zoomControl: false }).setView([23.6, 120.9], 8);
    window.map = map;

    const baseLayers = {
        'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 25, maxNativeZoom: 20 }).addTo(map),
        'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 25, maxNativeZoom: 20 })
    };
    L.control.layers(baseLayers).addTo(map);
    geoJsonLayers.addTo(map);
});

window.loadKmlLayerFromFirestore = async function(kmlId) {
    if (!kmlId) return;
    window.currentKmlLayerId = kmlId;
    
    try {
        const doc = await window.db.collection('artifacts').doc(window.appId)
            .collection('public').doc('data').collection('kmlLayers').doc(kmlId).get();
        
        if (!doc.exists) return;
        const data = doc.data();
        const geojson = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson;
        
        geoJsonLayers.clearLayers();
        window.allKmlFeatures = geojson.features;

        L.geoJSON(geojson, {
            pointToLayer: (feature, latlng) => {
                const marker = L.circleMarker(latlng, {
                    radius: 8, fillColor: "#ff4d4d", color: "#fff", weight: 2, fillOpacity: 0.9
                });
                marker.bindTooltip(feature.properties.name || "", {
                    permanent: true, direction: 'right', className: 'marker-label-v196'
                });
                // 點擊觸發清查
                marker.on('click', () => {
                    if(window.openSurveyPanel) window.openSurveyPanel(feature, latlng);
                });
                return marker;
            }
        }).addTo(geoJsonLayers);

        const bounds = geoJsonLayers.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
    } catch (e) { console.error("載入失敗", e); }
};