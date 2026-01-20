// map-logic.js v2.1
let map, markers = L.featureGroup(), navButtons = L.featureGroup(), geoJsonLayers = L.featureGroup();
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    map = L.map('map', { zoomControl: false, maxZoom: 25 }).setView([23.6, 120.9], 8);
    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}').addTo(map);
    markers.addTo(map);
    navButtons.addTo(map);
    geoJsonLayers.addTo(map); //
});

window.addGeoJsonLayers = function(features) {
    markers.clearLayers();
    features.forEach(f => {
        const [lon, lat] = f.geometry.coordinates;
        const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');
        
        // 16x16 紅點
        const dot = L.marker([lat, lon], {
            icon: L.divIcon({ className: 'custom-dot-icon', iconSize: [16, 16], iconAnchor: [8, 8] })
        }).addTo(markers);

        // 文字標籤
        const label = L.marker([lat, lon], {
            icon: L.divIcon({
                className: 'marker-label',
                html: `<span id="${labelId}">${f.properties.name}</span>`,
                iconAnchor: [-10, 10]
            }),
            interactive: false
        }).addTo(markers);

        dot.on('click', () => window.createNavButton([lat, lon], f.properties.name, labelId));
    });
};

window.createNavButton = function(latlng, name, labelId) {
    navButtons.clearLayers();
    document.querySelectorAll('.marker-label span').forEach(el => el.classList.remove('label-active'));
    document.getElementById(labelId)?.classList.add('label-active'); // 高亮標籤

    const navIcon = L.divIcon({
        className: 'nav-button-icon',
        html: `<img src="https://i0.wp.com/canadasafetycouncil.org/wp-content/uploads/2018/08/offroad.png" style="width:50px;">`,
        iconSize: [50, 50], iconAnchor: [25, 25]
    });
    L.marker(latlng, { icon: navIcon }).addTo(navButtons).on('click', () => {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${latlng[0]},${latlng[1]}`);
    });
    map.panTo(latlng);
};