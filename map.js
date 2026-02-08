document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map', { 
        zoomControl: false, 
        maxZoom: 25, 
        minZoom: 5,
        attributionControl: true 
    }).setView([23.6, 120.9], 8);
    window.App.map = map;

    const baseLayers = {
        'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { attribution: 'Google Maps' }),
        'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { attribution: 'Google Maps' }),
        'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: 'OSM' })
    };
    baseLayers['Google 街道圖'].addTo(map);
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

    // 恢復 v1.9.6 右下角定位控制項
    const LocateMeControl = L.Control.extend({
        onAdd: function() {
            const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control-custom');
            div.style.backgroundColor = 'white';
            div.style.width = '34px';
            div.style.height = '34px';
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'center';
            div.style.cursor = 'pointer';
            div.innerHTML = '<span class="material-symbols-outlined">my_location</span>';
            div.title = "定位我的位置";
            div.onclick = function() { map.locate({ setView: true, maxZoom: 16 }); };
            return div;
        }
    });
    map.addControl(new LocateMeControl({ position: 'bottomright' }));

    window.App.markers.addTo(map);
    window.App.geoJsonLayers.addTo(map);
});