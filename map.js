document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map', { zoomControl: false, maxZoom: 25, minZoom: 5 }).setView([23.6, 120.9], 8);
    window.App.map = map;

    // 1. 定義底圖
    const baseLayers = {
        'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'),
        'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'),
        'Google 地形圖': L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}'),
        'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
    };
    baseLayers['Google 街道圖'].addTo(map);

    // 2. 依照 v1.9.6 順序手動添加控制項 (右上角)
    
    // (A) 最上方：圖層切換
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

    // (B) 中間：定位按鈕
    const LocateCtrl = L.Control.extend({
        onAdd: () => {
            const btn = L.DomUtil.create('div', 'leaflet-bar leaflet-control-custom');
            btn.style.backgroundColor = 'white';
            btn.style.width = '30px';
            btn.style.height = '30px';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.innerHTML = '<span class="material-symbols-outlined" style="cursor:pointer; font-size:20px;">my_location</span>';
            btn.onclick = () => map.locate({ setView: true, maxZoom: 16 });
            return btn;
        }
    });
    map.addControl(new LocateCtrl({ position: 'topright' }));

    // (C) 最下方：縮放按鈕
    L.control.zoom({ position: 'topright' }).addTo(map);

    window.App.markers.addTo(map);
    window.App.geoJsonLayers.addTo(map);
});