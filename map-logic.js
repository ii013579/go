// map-logic.js v2.1
// 依賴: firebase-init.js (提供 db, appId)

let map;
let markers = L.featureGroup();
let navButtons = L.featureGroup();
let geoJsonLayers = L.featureGroup();
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    // 1. 初始化地圖實例 (掛載到 window 確保全域存取)
    window.map = L.map('map', {
        zoomControl: false,
        maxZoom: 25,
        minZoom: 5
    }).setView([23.6, 120.9], 8);

    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 25,
        maxNativeZoom: 20
    }).addTo(window.map);

    // 2. 將圖層群組加入地圖
    geoJsonLayers.addTo(window.map);
    markers.addTo(window.map);
    navButtons.addTo(window.map);
});

/**
 * 從 Firestore 讀取 KML 並渲染 (供選單觸發)
 */
window.loadKmlLayerFromFirestore = async function(kmlId) {
    if (!kmlId) {
        markers.clearLayers();
        navButtons.clearLayers();
        window.allKmlFeatures = [];
        return;
    }

    try {
        const docRef = db.collection('artifacts').doc(appId)
                         .collection('public').doc('data')
                         .collection('kmlLayers').doc(kmlId);
        
        const doc = await docRef.get();
        if (!doc.exists) return;

        const kmlData = doc.data();
        let geojson = typeof kmlData.geojson === 'string' ? JSON.parse(kmlData.geojson) : kmlData.geojson;
        
        window.allKmlFeatures = (geojson.features || []).filter(f => f.geometry && f.properties);
        window.renderMapPoints(window.allKmlFeatures);

    } catch (error) {
        console.error("載入 KML 失敗:", error);
    }
};

/**
 * 渲染紅點與文字標籤
 */
window.renderMapPoints = function(features) {
    markers.clearLayers();
    features.forEach(f => {
        const [lon, lat] = f.geometry.coordinates;
        const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');

        // 建立 16x16 紅點
        const dot = L.marker([lat, lon], {
            icon: L.divIcon({ className: 'custom-dot-icon', iconSize: [16, 16], iconAnchor: [8, 8] })
        }).addTo(markers);

        // 建立名稱標籤
        L.marker([lat, lon], {
            icon: L.divIcon({
                className: 'marker-label',
                html: `<span id="${labelId}">${f.properties.name}</span>`,
                iconAnchor: [-10, 10]
            }),
            interactive: false
        }).addTo(markers);

        // 點擊事件
        dot.on('click', () => window.activatePointLogic([lat, lon], f.properties.name, labelId));
    });

    if (markers.getLayers().length > 0) {
        window.map.fitBounds(markers.getBounds(), { padding: [50, 50] });
    }
};

/**
 * 觸發標籤高亮與生成導航按鈕 (offroad.png)
 */
window.activatePointLogic = function(latlng, name, labelId) {
    navButtons.clearLayers();
    
    // 移除所有舊的高亮，並激活新的
    document.querySelectorAll('.marker-label span').forEach(el => el.classList.remove('label-active'));
    const targetLabel = document.getElementById(labelId);
    if (targetLabel) targetLabel.classList.add('label-active');

    // 生成藍圈導航按鈕
    const navIcon = L.divIcon({
        className: 'nav-button-icon',
        html: `<img src="https://i0.wp.com/canadasafetycouncil.org/wp-content/uploads/2018/08/offroad.png" style="width:50px;">`,
        iconSize: [50, 50],
        iconAnchor: [25, 25]
    });

    L.marker(latlng, { icon: navIcon }).addTo(navButtons).on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${latlng[0]},${latlng[1]}`);
    });

    window.map.panTo(latlng);
};