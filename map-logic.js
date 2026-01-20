// map-logic.js v2.1
window.map = null;
window.markers = L.featureGroup();
window.navButtons = L.featureGroup();
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    // 初始化地圖並掛載到 window
    window.map = L.map('map', {
        zoomControl: false,
        maxZoom: 25,
        minZoom: 5
    }).setView([23.6, 120.9], 8);

    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 25,
        maxNativeZoom: 20
    }).addTo(window.map);

    window.markers.addTo(window.map);
    window.navButtons.addTo(window.map);

    // 讀取本地釘選紀錄（免登入自動載入功能）
    const pinnedId = localStorage.getItem('pinnedKmlId');
    if (pinnedId) {
        setTimeout(() => window.loadKmlFromFirestore(pinnedId), 500);
    }
});

// 提供給外部（如選單）呼叫的載入介面
window.loadKmlFromFirestore = async function(kmlId) {
    if (!kmlId) {
        window.markers.clearLayers();
        window.navButtons.clearLayers();
        return;
    }
    try {
        const doc = await db.collection('artifacts').doc(appId).collection('public')
                            .doc('data').collection('kmlLayers').doc(kmlId).get();
        if (doc.exists) {
            let data = doc.data();
            let geojson = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson;
            window.allKmlFeatures = geojson.features || [];
            window.renderMapPoints(window.allKmlFeatures);
        }
    } catch (e) { console.error("KML 載入失敗:", e); }
};

window.renderMapPoints = function(features) {
    window.markers.clearLayers();
    features.forEach(f => {
        const [lon, lat] = f.geometry.coordinates;
        const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');
        
        const dot = L.marker([lat, lon], {
            icon: L.divIcon({ className: 'custom-dot-icon', iconSize: [16, 16], iconAnchor: [8, 8] })
        }).addTo(window.markers);

        L.marker([lat, lon], {
            icon: L.divIcon({ className: 'marker-label', html: `<span id="${labelId}">${f.properties.name}</span>`, iconAnchor: [-10, 10] }),
            interactive: false
        }).addTo(window.markers);

        dot.on('click', () => window.activatePoint(lat, lon, f.properties.name, labelId));
    });
    if (window.markers.getLayers().length > 0) {
        window.map.fitBounds(window.markers.getBounds(), { padding: [50, 50] });
    }
};

window.activatePoint = function(lat, lon, name, labelId) {
    window.navButtons.clearLayers();
    document.querySelectorAll('.marker-label span').forEach(el => el.classList.remove('label-active'));
    document.getElementById(labelId)?.classList.add('label-active');
    
    const navIcon = L.divIcon({
        className: 'nav-button-icon',
        html: `<img src="https://i0.wp.com/canadasafetycouncil.org/wp-content/uploads/2018/08/offroad.png" style="width:50px;">`,
        iconSize: [50, 50], iconAnchor: [25, 25]
    });
    L.marker([lat, lon], { icon: navIcon }).addTo(window.navButtons).on('click', () => {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`);
    });
    window.map.panTo([lat, lon]);
};