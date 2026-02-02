/*************************************************
 * map.js
 * 地圖顯示（v1.9.6 等價）
 *************************************************/

let map;
let markers;
let navButtons;

/**
 * 初始化地圖
 */
window.initMap = function () {
    map = L.map('map', {
        center: [23.7, 121],
        zoom: 7
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(map);

    markers = L.layerGroup().addTo(map);
    navButtons = L.layerGroup().addTo(map);

    console.log('[map] initialized');
};

/**
 * 接收 KML 載入事件
 */
document.addEventListener('kml-loaded', (e) => {
    const geojson = e.detail.geojson;
    drawGeoJson(geojson);
});

/**
 * 繪製 GeoJSON（只處理 Point）
 */
function drawGeoJson(geojson) {
    markers.clearLayers();
    navButtons.clearLayers();

    if (!geojson || !geojson.features) return;

    const pointFeatures = geojson.features.filter(
        f => f.geometry?.type === 'Point'
    );

    pointFeatures.forEach(f => {
        const [lon, lat] = f.geometry.coordinates;
        const latlng = L.latLng(lat, lon);
        const name = f.properties?.name || '未命名';

        const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');

        // 紅點
        const dot = L.marker(latlng, {
            icon: L.divIcon({
                className: 'custom-dot-icon',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            }),
            interactive: true
        });

        // Label
        const label = L.marker(latlng, {
            icon: L.divIcon({
                className: 'marker-label',
                html: `<span id="${labelId}">${name}</span>`
            }),
            interactive: false,
            zIndexOffset: 1000
        });

        dot.on('click', (e) => {
            L.DomEvent.stopPropagation(e);

            // label active
            document
                .querySelectorAll('.marker-label span.label-active')
                .forEach(el => el.classList.remove('label-active'));

            const target = document.getElementById(labelId);
            if (target) target.classList.add('label-active');

            createNavButton(latlng, name);
        });

        markers.addLayer(dot);
        markers.addLayer(label);
    });

    console.log(`[map] drawn ${pointFeatures.length} points`);
}

/**
 * 導航按鈕（v1.9.6 行為）
 */
window.createNavButton = function (latlng, name) {
    navButtons.clearLayers();

    const googleMapsUrl = `https://maps.google.com/?q=${latlng.lat},${latlng.lng}`;

    const icon = L.divIcon({
        className: 'nav-button-icon',
        html: `
            <div class="nav-button-content">
                <img src="https://i0.wp.com/canadasafetycouncil.org/wp-content/uploads/2018/08/offroad.png"/>
            </div>
        `,
        iconSize: [50, 50],
        iconAnchor: [25, 25]
    });

    const marker = L.marker(latlng, {
        icon,
        zIndexOffset: 2000,
        interactive: true
    }).addTo(navButtons);

    marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        window.open(googleMapsUrl, '_blank');
    });

    map.panTo(latlng, { duration: 0.5 });
};
