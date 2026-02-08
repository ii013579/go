document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map', { zoomControl: false, maxZoom: 25 }).setView([23.6, 120.9], 8);
    window.App.map = map;

    const base = {
        'Google 街道': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'),
        'Google 衛星': L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'),
        'OSM': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
    };
    base['Google 街道'].addTo(map);
    L.control.layers(base).addTo(map);

    L.Control.extend({
        onAdd: () => {
            const btn = L.DomUtil.create('div', 'leaflet-bar leaflet-control-custom');
            btn.innerHTML = '<span class="material-symbols-outlined">my_location</span>';
            btn.onclick = () => map.locate({ setView: true, maxZoom: 16 });
            return btn;
        }
    }).prototype.addTo.call(new (L.Control.extend({}))({ position: 'bottomright' }), map);

    window.App.markers.addTo(map);
    window.App.geoJsonLayers.addTo(map);
});