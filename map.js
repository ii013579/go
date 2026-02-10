/**
 * 檔名：map.js
 * 版本：v2.1.3
 * 權責：地圖引擎、UI 面板排列
 * 功能：[修正 3-5] 定位按鈕狀態(變紅/取消)，依照圖片排列控制項。
 */
document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map', { zoomControl: false }).setView([23.6, 120.9], 8);
    window.App.map = map;
    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}').addTo(map);

    // --- 依照圖片垂直排列控制項 ---
    // 1. 圖層切換 (置於最上方)
    L.control.layers({}, {}, { position: 'topright' }).addTo(map);

    // 2. 定位按鈕 (自定義狀態切換)
    const LocateBtn = L.Control.extend({
        onAdd: function() {
            const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control-custom');
            div.id = "locate-btn-ui";
            div.style.cssText = "background:white;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;";
            div.innerHTML = '<span class="material-symbols-outlined">my_location</span>';
            
            div.onclick = () => {
                if (!window.App.isLocating) {
                    map.locate({ setView: true, watch: true, maxZoom: 16 });
                } else {
                    window.cancelLocate();
                }
            };
            return div;
        }
    });
    map.addControl(new LocateBtn({ position: 'topright' }));

    // 3. 縮放按鈕 (置於下方)
    L.control.zoom({ position: 'topright' }).addTo(map);

    // --- 定位事件處理 ---
    map.on('locationstart', () => {
        window.App.isLocating = true;
        document.getElementById('locate-btn-ui').style.color = "red"; // 按鈕變紅
        if (window.showMessage) window.showMessage("定位中", "正在獲取 GPS 位置...");
    });

    map.on('locationfound', (e) => {
        if (window.hideMessage) window.hideMessage();
        if (window.App.userLocMarker) map.removeLayer(window.App.userLocMarker);
        window.App.userLocMarker = L.circleMarker(e.latlng, { radius: 10, fillColor: "#007bff", color: "#fff", weight: 3, fillOpacity: 0.9 }).addTo(map);
    });

    window.cancelLocate = () => {
        map.stopLocate();
        window.App.isLocating = false;
        document.getElementById('locate-btn-ui').style.color = "black"; // 恢復黑色
        if (window.App.userLocMarker) { map.removeLayer(window.App.userLocMarker); window.App.userLocMarker = null; }
        alert("已停止定位");
    };

    window.App.markers.addTo(map);
    window.App.geoJsonLayers.addTo(map);
});