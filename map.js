document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map', { 
        zoomControl: false, 
        maxZoom: 25, 
        minZoom: 5,
        attributionControl: true 
    }).setView([23.6, 120.9], 8);
    window.App.map = map;

    const baseLayers = {
'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'),
        'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'),
        'Google 地形圖': L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}'),
        'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
    };
    baseLayers['Google 街道圖'].addTo(map);
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

// 恢復縮放按鈕
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // 恢復定位按鈕
    const LocateCtrl = L.Control.extend({
        onAdd: () => {
            const btn = L.DomUtil.create('div', 'leaflet-bar leaflet-control-custom');
            btn.innerHTML = '<span class="material-symbols-outlined" style="line-height:30px; cursor:pointer;">my_location</span>';
            btn.onclick = () => map.locate({ setView: true, maxZoom: 16 });
            return btn;
        }
    });
    map.addControl(new LocateCtrl({ position: 'bottomright' }));

    window.App.markers.addTo(map);
    window.App.geoJsonLayers.addTo(map);
});