/**
 * 檔名：map.js
 * 版本：v2.1.0
 * 權責：地圖引擎初始化、UI 面板排列、定位增強功能
 * 功能：
 * - 恢復 v1.9.6 右上角垂直面板 (縮放 -> 定位 -> 圖層)
 * - 處理定位中訊息顯示、藍點標記與取消定位邏輯
 */
document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map', { zoomControl: false, maxZoom: 25, minZoom: 5 }).setView([23.6, 120.9], 8);
    window.App.map = map;

    const baseLayers = {
        'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'),
        'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'),
        'Google 地形圖': L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}'),
        'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
    };
    baseLayers['Google 街道圖'].addTo(map);

    // --- 恢復 v1.9.6 垂直排列順序 ---
    L.control.zoom({ position: 'topright' }).addTo(map);

    let userLocMarker = null;
    const LocateBtn = L.Control.extend({
        onAdd: function() {
            const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control-custom');
            div.style.backgroundColor = 'white'; div.style.width = '32px'; div.style.height = '32px';
            div.style.display = 'flex'; div.style.alignItems = 'center'; div.style.justifyContent = 'center';
            div.style.cursor = 'pointer';
            div.innerHTML = '<span class="material-symbols-outlined" style="font-size:22px;">my_location</span>';
            div.onclick = () => map.locate({ setView: true, maxZoom: 16 });
            return div;
        }
    });
    map.addControl(new LocateBtn({ position: 'topright' }));
    L.control.layers(baseLayers, null, { position: 'topright', collapsed: true }).addTo(map);

    // --- 定位增強邏輯 ---
    map.on('locationstart', () => {
        if (window.showMessage) window.showMessage("定位系統", "正在獲取您的目前位置...");
    });
    map.on('locationfound', (e) => {
        const msg = document.getElementById('messageBoxOverlay');
        if(msg) msg.classList.remove('visible');
        if (userLocMarker) map.removeLayer(userLocMarker);
        userLocMarker = L.circleMarker(e.latlng, { radius: 10, fillColor: "#007bff", color: "#fff", weight: 3, fillOpacity: 0.9 }).addTo(map);
        userLocMarker.bindPopup("目前位置").openPopup();
    });

    window.cancelLocate = () => {
        map.stopLocate();
        if (userLocMarker) { map.removeLayer(userLocMarker); userLocMarker = null; }
    };

    window.App.markers.addTo(map);
    window.App.geoJsonLayers.addTo(map);
});