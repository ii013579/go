document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map', { zoomControl: false, maxZoom: 25, minZoom: 5 }).setView([23.6, 120.9], 8);
    window.App.map = map;

    const baseLayers = {
        'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'),
        'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'),
        'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
    };
    baseLayers['Google 街道圖'].addTo(map);
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

    const LocateCtrl = L.Control.extend({
        onAdd: () => {
            const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control-custom');
            div.innerHTML = '<span class="material-symbols-outlined" style="line-height:30px;">my_location</span>';
            div.onclick = () => map.locate({ setView: true, maxZoom: 16 });
            return div;
        }
    });
    map.addControl(new LocateCtrl({ position: 'bottomright' }));

    window.App.markers.addTo(map);
    window.App.geoJsonLayers.addTo(map);
});