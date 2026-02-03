// map.js — v2.0 baseline，等同 map-logic.js 的地圖職責

window.map = null;
window.markers = null;
window.navButtons = null;

window.initMap = function () {
    window.map = L.map('map').setView([23.7, 121], 7);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(window.map);

    window.markers = L.layerGroup().addTo(window.map);
    window.navButtons = L.layerGroup().addTo(window.map);
};

// ?? 保證 DOM ready 就初始化（v1.9.6 行為）
document.addEventListener('DOMContentLoaded', () => {
    initMap();
});

// === v1.9.6 依賴 ===
window.createNavButton = function (latlng, name) {
    window.navButtons.clearLayers();

    const url = `https://maps.google.com/?q=${latlng.lat},${latlng.lng}`;

    const marker = L.marker(latlng, {
        icon: L.divIcon({
            className: 'nav-button-icon',
            html: `
              <div class="nav-button-content">
                <img src="https://i0.wp.com/canadasafetycouncil.org/wp-content/uploads/2018/08/offroad.png">
              </div>
            `,
            iconSize: [50, 50],
            iconAnchor: [25, 25]
        }),
        zIndexOffset: 2000
    }).addTo(window.navButtons);

    marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        window.open(url, '_blank');
    });

    window.map.panTo(latlng);
};
