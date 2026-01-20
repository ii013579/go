// map-logic.js v1.9.6 完整提取版

let map;
let markers = L.featureGroup();
let navButtons = L.featureGroup();
let geoJsonLayers = L.featureGroup();
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    // 初始化地圖與底圖
    map = L.map('map', {
        attributionControl: true,
        zoomControl: false,
        maxZoom: 25,
        minZoom: 5
    }).setView([23.6, 120.9], 8);

    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        attribution: 'Google Maps',
        maxZoom: 25,
        maxNativeZoom: 20
    }).addTo(map);

    geoJsonLayers.addTo(map);
    markers.addTo(map);
    navButtons.addTo(map);

    // 設定 z-index 確保標籤與導航按鈕在最上層
    map.getPane('markerPane').style.zIndex = 600;
});

// 核心函數：添加 GeoJSON 圖層 (完全依照 v1.9.6 邏輯)
window.addGeoJsonLayers = function(geojsonFeatures) {
    if (!map) return;
    geoJsonLayers.clearLayers();
    markers.clearLayers();
    navButtons.clearLayers();

    geojsonFeatures.forEach(f => {
        if (f.geometry && f.geometry.type === 'Point' && f.geometry.coordinates) {
            const [lon, lat] = f.geometry.coordinates;
            const latlng = L.latLng(lat, lon);
            const name = f.properties ? (f.properties.name || '未命名') : '未命名';
            
            // v1.9.6 專屬的 ID 產生邏輯，用於連結搜尋高亮
            const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');

            // 1. 紅點 Icon (16x16)
            const dotIcon = L.divIcon({
                className: 'custom-dot-icon',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });

            const dot = L.marker(latlng, { icon: dotIcon, interactive: true });

            // 2. 文字標籤 (帶有動態 ID)
            const label = L.marker(latlng, {
                icon: L.divIcon({
                    className: 'marker-label',
                    html: `<span id="${labelId}">${name}</span>`,
                    iconSize: [null, null],
                    iconAnchor: [0, 0]
                }),
                interactive: false,
                zIndexOffset: 1000
            });

            dot.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                // 取消舊的高亮
                document.querySelectorAll('.marker-label span.label-active').forEach(el => {
                    el.classList.remove('label-active');
                });
                // 激活當前標籤
                const target = document.getElementById(labelId);
                if (target) target.classList.add('label-active');
                
                // 創建導航按鈕
                if (typeof window.createNavButton === 'function') {
                    window.createNavButton(latlng, name);
                }
            });
            
            markers.addLayer(dot);
            markers.addLayer(label);
        }
    });
    window.allKmlFeatures = geojsonFeatures;
};

// v1.9.6 特有的導航按鈕功能 (包含 offroad 圖示)
window.createNavButton = function(latlng, name) {
    if (!map) return;
    navButtons.clearLayers();

    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latlng.lat},${latlng.lng}`;
    const buttonHtml = `
        <div class="nav-button-content">
            <img src="https://i0.wp.com/canadasafetycouncil.org/wp-content/uploads/2018/08/offroad.png" alt="導航" />
        </div>
    `;
    const buttonIcon = L.divIcon({
        className: 'nav-button-icon',
        html: buttonHtml,
        iconSize: [50, 50],
        iconAnchor: [25, 25]
    });

    const navMarker = L.marker(latlng, {
        icon: buttonIcon,
        zIndexOffset: 2000,
        interactive: true
    }).addTo(navButtons);

    navMarker.on('click', function(e) {
        L.DomEvent.stopPropagation(e);
        window.open(googleMapsUrl, '_blank');
    });

    map.panTo(latlng, { duration: 0.5 });
};

// 載入與鎖定邏輯
window.loadKmlLayerFromFirestore = async function(kmlId) {
    if (window.isLoadingKml) return;
    window.isLoadingKml = true;
    try {
        const doc = await db.collection('artifacts').doc(appId).collection('public')
                            .doc('data').collection('kmlLayers').doc(kmlId).get();
        if (doc.exists) {
            let geojson = doc.data().geojson;
            if (typeof geojson === 'string') geojson = JSON.parse(geojson);
            window.addGeoJsonLayers(geojson.features || []);
        }
    } finally {
        window.isLoadingKml = false;
    }
};