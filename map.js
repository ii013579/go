document.addEventListener('DOMContentLoaded', () => {
    // 建立地圖，關閉預設縮放控制
    const map = L.map('map', { zoomControl: false, maxZoom: 25, minZoom: 5 }).setView([23.6, 120.9], 8);
    window.App.map = map;

    const baseLayers = {
        'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'),
        'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'),
        'Google 地形圖': L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}'),
        'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
    };
    baseLayers['Google 街道圖'].addTo(map);

    // --- 嚴格依照 v1.9.6 順序添加 (由上至下) ---
    
    // 1. 最上方：縮放按鈕
    L.control.zoom({ position: 'topright' }).addTo(map);

    // 2. 中間：定位按鈕
    const LocateBtn = L.Control.extend({
        onAdd: function() {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control-custom');
            container.innerHTML = '<button title="我的位置" style="background:#fff; width:30px; height:30px; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer;"><span class="material-symbols-outlined" style="font-size:20px;">my_location</span></button>';
            container.onclick = () => map.locate({ setView: true, maxZoom: 16 });
            return container;
        }
    });
    map.addControl(new LocateBtn({ position: 'topright' }));

    // 3. 最下方：圖層切換 (樣式需符合 image_d1d193.png)
    L.control.layers(baseLayers, null, { position: 'topright', collapsed: true }).addTo(map);

    window.App.markers.addTo(map);
    window.App.geoJsonLayers.addTo(map);
});