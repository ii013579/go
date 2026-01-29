//(介面互動模組)
// ui-interactions.js v2.0 
(function () {
    'use strict';
    const $ = id => document.getElementById(id);

    // --- 定位相關變數 ---
    let userMarker = null;

    /**
     * 初始化地理定位功能 (加回 v1.9.6 的脈衝圓點邏輯)
     */
    const initLocation = () => {
        if (!navigator.geolocation) {
            console.warn("瀏覽器不支援地理定位");
            return;
        }

        const geoOptions = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        };

        const success = (position) => {
            const { latitude, longitude } = position.coords;
            const latlng = [latitude, longitude];

            // 確保地圖已載入
            if (!window.mapLayers || !window.mapLayers.map) return;
            const map = window.mapLayers.map;

            if (userMarker) {
                userMarker.setLatLng(latlng);
            } else {
                // 使用 style.css 中的 .user-location-dot 樣式
                const locationIcon = L.divIcon({
                    className: 'user-location-dot',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                });
                userMarker = L.marker(latlng, { 
                    icon: locationIcon,
                    zIndexOffset: 1000 // 確保定位點在最上層
                }).addTo(map);
                
                // 首次取得定位後，將視角移至使用者位置
                map.setView(latlng, 16);
            }
        };

        const error = (err) => {
            console.warn(`定位失敗 (${err.code}): ${err.message}`);
            // 排除使用者主動拒絕的情況，才彈出錯誤提示
            if (err.code !== 1 && window.showMessage) {
                window.showMessage('定位提示', '無法取得您的目前位置，請檢查 GPS 是否開啟。');
            }
        };

        // 持續監控位置
        navigator.geolocation.watchPosition(success, error, geoOptions);
    };

    /**
     * 處理搜尋功能與結果清單
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

            // 從 DataManager 的快取中過濾
            const matched = window.DataManager.allFeatures.filter(f => 
                f.properties.name?.toLowerCase().includes(query)
            ).slice(0, 10); // 僅顯示前 10 筆提高效能

            if (matched.length > 0) {
                matched.forEach(f => {
                    const div = document.createElement('div');
                    div.className = 'search-result-item';
                    div.textContent = f.properties.name;
                    div.onclick = () => {
                        handleSearchResultClick(f);
                        searchResults.style.display = 'none';
                        searchBox.value = f.properties.name;
                    };
                    searchResults.appendChild(div);
                });
                searchResults.style.display = 'block';
            } else {
                searchResults.style.display = 'none';
            }
        });

        // 點擊外部關閉搜尋結果
        document.addEventListener('click', (e) => {
            if (!searchBox.contains(e.target) && !searchResults.contains(e.target)) {
                searchResults.style.display = 'none';
            }
        });
    };

    /**
     * 點擊搜尋結果後的跳轉邏輯
     */
    const handleSearchResultClick = (feature) => {
        if (!window.mapLayers || !window.mapLayers.map) return;
        const map = window.mapLayers.map;

        let targetLatLng;
        if (feature.geometry.type === 'Point') {
            const [lon, lat] = feature.geometry.coordinates;
            targetLatLng = [lat, lon];
        } else if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
            // 使用渲染器中的質心演算法
            const cp = window.getPolygonCentroid(feature.geometry.coordinates);
            targetLatLng = [cp[1], cp[0]];
        }

        if (targetLatLng) {
            map.setView(targetLatLng, 18);
            // 觸發導航按鈕
            if (window.createNavButton) {
                window.createNavButton(targetLatLng, feature.properties.name);
            }
        }
    };

    /**
     * 初始化介面按鈕 (編輯/返回地圖)
     */
    const initUIButtons = () => {
        const editBtn = $('editButton');
        const authSec = $('authSection');
        const controls = $('controls');

        if (editBtn) {
            editBtn.onclick = () => {
                const isAuthVisible = (authSec.style.display === 'flex');
                
                if (isAuthVisible) {
                    // 切換回地圖模式
                    authSec.style.display = 'none';
                    controls.style.display = 'flex';
                    editBtn.textContent = '編輯';
                    editBtn.classList.remove('active');
                } else {
                    // 切換至編輯/登入模式
                    authSec.style.display = 'flex';
                    controls.style.display = 'none';
                    editBtn.textContent = '返回地圖';
                    editBtn.classList.add('active');
                }
            };
        }
    };

    // --- 啟動初始化 ---
    document.addEventListener('DOMContentLoaded', () => {
        initLocation();   // 啟動 GPS 定位
        initSearch();     // 啟動搜尋功能
        initUIButtons();  // 啟動按鈕監聽
    });

})();