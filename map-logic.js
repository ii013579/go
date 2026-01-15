let map;
let geoJsonLayers = L.featureGroup();
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    map = L.map('map', { zoomControl: false, maxZoom: 25 }).setView([23.6, 120.9], 8);
    window.map = map;
    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { 
        maxZoom: 25, 
        maxNativeZoom: 20 
    }).addTo(map);
    geoJsonLayers.addTo(map);

    document.getElementById('kmlLayerSelect')?.addEventListener('change', (e) => {
        window.loadKmlLayerFromFirestore(e.target.value);
    });
});

window.updateKmlLayerSelects = async function() {
    const snap = await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').get();
    let options = '<option value="">-- 請選擇圖層 --</option>';
    snap.forEach(doc => {
        options += `<option value="${doc.id}">${doc.data().name}</option>`;
    });
    document.getElementById('kmlLayerSelect').innerHTML = options;
    document.getElementById('kmlLayerSelectDashboard').innerHTML = options;
};

window.loadKmlLayerFromFirestore = async function(kmlId) {
    if (!kmlId) return;
    window.currentKmlLayerId = kmlId;
    const doc = await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').doc(kmlId).get();
    
    if (doc.exists) {
        const data = doc.data();
        const geojson = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson;
        geoJsonLayers.clearLayers();
        window.allKmlFeatures = geojson.features;

        L.geoJSON(geojson, {
            pointToLayer: (feature, latlng) => {
                // 完全還原 v1.9.6 橘紅點樣式
                const marker = L.circleMarker(latlng, {
                    radius: 8,
                    fillColor: "#ff7800",
                    color: "#000",
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
                marker.on('click', () => {
                    if(window.openSurveyPanel) window.openSurveyPanel(feature, latlng);
                });
                return marker;
            }
        }).addTo(geoJsonLayers);
        map.fitBounds(geoJsonLayers.getBounds(), { padding: [50, 50] });
    }
};