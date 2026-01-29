//(介面互動模組)
// ui.js v2.0 
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    let userMarker = null;

    // 定位按鈕控制項邏輯 (對應 CSS .leaflet-control-locate-me)
    L.Control.LocateMe = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function (map) {
            const container = L.DomUtil.create('div', 'leaflet-control-locate-me');
            const link = L.DomUtil.create('a', '', container);
            link.href = '#';
            link.title = '我的位置';
            link.innerHTML = '??';
            L.DomEvent.on(link, 'click', (e) => {
                L.DomEvent.stopPropagation(e);
                L.DomEvent.preventDefault(e);
                if (userMarker) {
                    map.setView(userMarker.getLatLng(), 17);
                } else {
                    alert("取得定位中，請稍候...");
                }
            });
            return container;
        }
    });

    const initMapInteractions = () => {
        if (!window.mapLayers || !window.mapLayers.map) return;
        const map = window.mapLayers.map;

        // 1. 加回定位按鈕
        new L.Control.LocateMe().addTo(map);

        // 2. 啟動 GPS 監控 (對應 CSS .user-location-dot)
        if (navigator.geolocation) {
            navigator.geolocation.watchPosition((pos) => {
                const latlng = [pos.coords.latitude, pos.coords.longitude];
                if (userMarker) {
                    userMarker.setLatLng(latlng);
                } else {
                    userMarker = L.marker(latlng, {
                        icon: L.divIcon({ 
                            className: 'user-location-dot', 
                            iconSize: [16, 16],
                            iconAnchor: [8, 8]
                        })
                    }).addTo(map);
                    map.setView(latlng, 16);
                }
            }, null, { enableHighAccuracy: true });
        }

        // 3. 搜尋功能
        const searchBox = $('searchBox');
        const results = $('searchResults');
        if (searchBox && results) {
            searchBox.addEventListener('input', (e) => {
                const val = e.target.value.toLowerCase();
                if (!val) { results.style.display = 'none'; return; }
                
                const matched = (window.DataManager.allFeatures || []).filter(f => 
                    f.properties.name?.toLowerCase().includes(val)
                ).slice(0, 10);
                
                results.innerHTML = matched.map(f => `<div class="result-item">${f.properties.name}</div>`).join('');
                results.style.display = matched.length ? 'grid' : 'none';
                
                results.querySelectorAll('.result-item').forEach((el, idx) => {
                    el.onclick = () => {
                        const f = matched[idx];
                        const coord = f.geometry.type === 'Point' ? 
                            [f.geometry.coordinates[1], f.geometry.coordinates[0]] : 
                            [f.geometry.coordinates[0][0][1], f.geometry.coordinates[0][0][0]];
                        map.setView(coord, 18);
                        window.createNavButton(coord, f.properties.name);
                        results.style.display = 'none';
                    };
                });
            });
        }
    };

    // 確保地圖核心載入後才初始化
    const checkMapReady = setInterval(() => {
        if (window.mapLayers && window.mapLayers.map) {
            clearInterval(checkMapReady);
            initMapInteractions();
        }
    }, 200);
})();