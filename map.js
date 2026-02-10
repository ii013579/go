document.addEventListener('DOMContentLoaded', () => {
    // 關閉預設縮放鍵，手動添加以控制順序
    const map = L.map('map', { zoomControl: false, maxZoom: 25, minZoom: 5 }).setView([23.6, 120.9], 8);
    window.App.map = map;

    const baseLayers = {
        'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'),
        'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'),
        'Google 地形圖': L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}'),
        'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
    };
    baseLayers['Google 街道圖'].addTo(map);

    // --- 依照 v1.9.6 順序添加至 topright ---
    // 1. 縮放
    L.control.zoom({ position: 'topright' }).addTo(map);

    // 2. 定位 (自定義樣式)
    const LocateBtn = L.Control.extend({
        onAdd: function() {
            const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control-custom');
            div.style.backgroundColor = 'white';
            div.style.width = '32px';
            div.style.height = '32px';
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'center';
            div.style.cursor = 'pointer';
            div.innerHTML = '<span class="material-symbols-outlined" style="font-size:22px;">my_location</span>';
            div.onclick = () => map.locate({ setView: true, maxZoom: 16 });
            return div;
        }
    });
    map.addControl(new LocateBtn({ position: 'topright' }));

    // 3. 圖層切換
    L.control.layers(baseLayers, null, { position: 'topright', collapsed: true }).addTo(map);

    window.App.markers.addTo(map);
    window.App.geoJsonLayers.addTo(map);
});