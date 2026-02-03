/*************************************************
 * map.js (v2.0, compatible with v1.9.6)
 *************************************************/

let map;
let markers;
let navButtons;

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
};

// 監聽 KML 載入事件（由 kml.js 觸發）
document.addEventListener('kml-loaded', (e) => {
    drawGeoJson(e.detail);
});

function drawGeoJson(geojson) {
    markers.clearLayers();
    navButtons.clearLayers();

    if (!geojson || !geojson.features) return;

    geojson.features
        .filter(f => f.geometry && f.geometry.type === 'Point')
        .forEach(f => {
            const [lon, lat] = f.geometry.coordinates;
            const latlng = L.latLng(lat, lon);
            const name = f.properties?.name || '未命名';
            const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');

            const dot = L.marker(latlng, {
                icon: L.divIcon({
                    className: 'custom-dot-icon',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                }),
                interactive: true
            });

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
}

window.createNavButton = function (latlng) {
    navButtons.clearLayers();

    const url = `https://maps.google.com/?q=${latlng.lat},${latlng.lng}`;

    const navMarker = L.marker(latlng, {
        icon: L.divIcon({
            className: 'nav-button-icon',
            html: `
              <div class="nav-button-content">
                <img src="https://i0.wp.com/canadasafetycouncil.org/wp-content/uploads/2018/08/offroad.png"/>
              </div>
            `,
            iconSize: [50, 50],
            iconAnchor: [25, 25]
        }),
        zIndexOffset: 2000,
        interactive: true
    }).addTo(navButtons);

    navMarker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        window.open(url, '_blank');
    });

    map.panTo(latlng, { duration: 0.5 });
};
