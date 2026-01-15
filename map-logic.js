// map-logic.js v2.0.0
let map;
let geoJsonLayers = L.featureGroup();
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    map = L.map('map', { zoomControl: false }).setView([23.6, 120.9], 8);
    window.map = map;
    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}').addTo(map);
    geoJsonLayers.addTo(map);
});

// 全域選單更新 (由 auth-kml-management 調用)
window.updateKmlLayerSelects = async function() {
    try {
        const snapshot = await window.db.collection('artifacts').doc(window.appId)
            .collection('public').doc('data').collection('kmlLayers').get();
        
        const html = ['<option value="">-- 請選擇 --</option>'];
        snapshot.forEach(doc => {
            html.push(`<option value="${doc.id}">${doc.data().name}</option>`);
        });

        document.getElementById('kmlLayerSelect').innerHTML = html.join('');
        document.getElementById('kmlLayerSelectDashboard').innerHTML = html.join('');
    } catch (e) { console.error("選單讀取錯誤", e); }
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
                const marker = L.circleMarker(latlng, { radius: 8, fillColor: "#ff4d4d", color: "#fff", weight: 2, fillOpacity: 0.9 });
                marker.bindTooltip(feature.properties.name || "", { 
                    permanent: true, direction: 'right', className: 'marker-label-v196' 
                });
                marker.on('click', () => window.openSurveyPanel(feature, latlng));
                return marker;
            }
        }).addTo(geoJsonLayers);
        map.fitBounds(geoJsonLayers.getBounds());
    }
};

// 監聽主選單切換
document.getElementById('kmlLayerSelect')?.addEventListener('change', (e) => {
    window.loadKmlLayerFromFirestore(e.target.value);
});