//(介面互動模組)
// ui-interactions.js v2.0 
// ui-interactions.js v2.0 - 完整版
(function () {
    'use strict';
    const $ = id => document.getElementById(id);

    // --- 定位相關變數 ---
    let userMarker = null;

    /**
     * 1. 建立自定義定位按鈕 (解決 image_1a628b.png 遺失按鈕問題)
     * 對應 CSS: .leaflet-control-locate-me
     */
    const addLocateButton = (map) => {
        // 避免重複建立
        if (document.querySelector('.leaflet-control-locate-me')) return;

        const LocateControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: function() {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-locate-me');
                container.innerHTML = '<a href="#" title="我的位置" style="display:flex;justify-content:center;align-items:center;text-decoration:none;font-size:18px;">??</a>';
                
                container.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (userMarker) {
                        map.setView(userMarker.getLatLng(), 17);
                    } else {
                        if (window.showMessage) window.showMessage('提示', '正在取得 GPS 定位中，請稍候...');
                    }
                };
                return container;
            }
        });
        map.addControl(new LocateControl());
    };

    /**
     * 2. 初始化地理定位與脈衝點
     * 對應 CSS: .user-location-dot
     */
    const initLocation = () => {
        if (!navigator.geolocation) return;

        const geoOptions = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };

        const success = (position) => {
            const { latitude, longitude } = position.coords;
            const latlng = [latitude, longitude];

            if (!window.mapLayers || !window.mapLayers.map) return;
            const map = window.mapLayers.map;

            if (userMarker) {
                userMarker.setLatLng(latlng);
            } else {
                const locationIcon = L.divIcon({
                    className: 'user-location-dot',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                });
                userMarker = L.marker(latlng, { icon: locationIcon, zIndexOffset: 1000 }).addTo(map);
                // 首次定位成功自動跳轉
                map.setView(latlng, 16);
            }
        };

        navigator.geolocation.watchPosition(success, (err) => console.warn(err), geoOptions);
    };

    /**
     * 3. 搜尋功能邏輯
     */
    const initSearch = () => {
        const searchBox = $('searchBox');
        const searchResults = $('searchResults');
        if (!searchBox || !searchResults) return;

        searchBox.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            searchResults.innerHTML = '';
            
            if (!query || !window.DataManager || !window.DataManager.allFeatures) {
                searchResults.style.display = 'none';
                return;
            }

            const matched = window.DataManager.allFeatures.filter(f => 
                f.properties.name?.toLowerCase().includes(query)
            ).slice(0, 10);

            if (matched.length > 0) {
                matched.forEach(f => {
                    const div = document.createElement('div');
                    div.className = 'result-item'; // 對應 style.css 中的搜尋結果樣式
                    div.textContent = f.properties.name;
                    div.onclick = () => {
                        handleSearchResultClick(f);
                        searchResults.style.display = 'none';
                        searchBox.value = f.properties.name;
                    };
                    searchResults.appendChild(div);
                });
                searchResults.style.display = 'grid'; // 配合 CSS 的 grid 佈局
                searchResults.classList.add('columns-2');
            } else {
                searchResults.style.display = 'none';
            }
        });
    };

    const handleSearchResultClick = (feature) => {
        if (!window.mapLayers || !window.mapLayers.map) return;
        const map = window.mapLayers.map;

        let latlng;
        if (feature.geometry.type === 'Point') {
            latlng = [feature.geometry.coordinates[1], feature.geometry.coordinates[0]];
        } else {
            const cp = window.getPolygonCentroid(feature.geometry.coordinates);
            latlng = [cp[1], cp[0]];
        }

        map.setView(latlng, 18);
        if (window.createNavButton) window.createNavButton(latlng, feature.properties.name);
    };

    /**
     * 4. UI 按鈕初始化
     */
    const initUIButtons = () => {
        const editBtn = $('editButton');
        if (editBtn) {
            editBtn.onclick = () => {
                const authSec = $('authSection');
                const controls = $('controls');
                const isAuthVisible = authSec.style.display === 'flex';
                authSec.style.display = isAuthVisible ? 'none' : 'flex';
                controls.style.display = isAuthVisible ? 'flex' : 'none';
                editBtn.textContent = isAuthVisible ? '編輯' : '返回地圖';
            };
        }
    };

    // --- 程式啟動點 ---
    document.addEventListener('DOMContentLoaded', () => {
        // 等待地圖核心載入完成
        const waitMap = setInterval(() => {
            if (window.mapLayers && window.mapLayers.map) {
                clearInterval(waitMap);
                addLocateButton(window.mapLayers.map); // 加回左上角按鈕
                initLocation();                        // 啟動 GPS
                initSearch();                          // 啟動搜尋
                initUIButtons();                       // 啟動介面按鈕
            }
        }, 100);
    });

})();