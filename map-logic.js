let map;
let geoJsonLayers = L.featureGroup();
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    map = L.map('map', { zoomControl: false }).setView([23.6, 120.9], 8);
    window.map = map;
    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}').addTo(map);
    geoJsonLayers.addTo(map);

    document.getElementById('kmlLayerSelect')?.addEventListener('change', (e) => {
        window.loadKmlLayerFromFirestore(e.target.value);
    });
});

window.updateKmlLayerSelects = async function() {
    const snapshot = await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').get();
    const html = ['<option value="">-- 請選擇 --</option>'];
    snapshot.forEach(doc => html.push(`<option value="${doc.id}">${doc.data().name}</option>`));
    document.getElementById('kmlLayerSelect').innerHTML = html.join('');
    document.getElementById('kmlLayerSelectDashboard').innerHTML = html.join('');
};

window.loadKmlLayerFromFirestore = async function(kmlId) {
    if (!kmlId) return;
    const doc = await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').doc(kmlId).get();
    if (doc.exists) {
        const geojson = JSON.parse(doc.data().geojson);
        geoJsonLayers.clearLayers();
        window.allKmlFeatures = geojson.features;
        L.geoJSON(geojson, {
            pointToLayer: (feature, latlng) => {
                const m = L.circleMarker(latlng, { radius: 8, fillColor: "#ff4d4d", color: "#fff", weight: 2, fillOpacity: 0.9 });
                m.bindTooltip(feature.properties.name || "", { 
                    permanent: true, direction: 'right', className: 'marker-label-v196' 
                });
                m.on('click', () => window.openSurveyPanel(feature, latlng));
                return m;
            }
        }).addTo(geoJsonLayers);
        map.fitBounds(geoJsonLayers.getBounds());
    }
};