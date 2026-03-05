// ui-interactions.js v2.03
document.addEventListener('DOMContentLoaded', () => {
    const editButton = document.getElementById('editButton');
    const authSection = document.getElementById('authSection');
    const controls = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');
    const searchResults = document.getElementById('searchResults');
    const searchContainer = document.getElementById('searchContainer'); 

    // 初始 UI 狀態
    if (authSection) authSection.style.display = 'none';
    if (controls) controls.style.display = 'flex';

    // 1. 編輯按鈕與認證區塊切換邏輯
    if (editButton && authSection && controls) {
        editButton.addEventListener('click', () => {
            const isAuthSectionVisible = authSection.style.display === 'flex';
            if (isAuthSectionVisible) {
                authSection.style.display = 'none';
                controls.style.display = 'flex';
                editButton.textContent = '編輯';
            } else {
                controls.style.display = 'none';
                authSection.style.display = 'flex';
                editButton.textContent = '關閉';
                
                // 開啟編輯模式時，若有未載入的圖層則嘗試同步
                if (window.mapNamespace && window.mapNamespace.allKmlFeatures.length > 0) {
                    if (typeof window.addGeoJsonLayers === 'function') {
                        window.addGeoJsonLayers(window.mapNamespace.allKmlFeatures);
                    }
                }   
            }
        });
    }

    // 2. 搜尋功能邏輯
    if (searchBox && searchResults && searchContainer) {
        searchBox.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            searchResults.innerHTML = '';

            if (query.length > 0) {
                let results = [];
                // 優先從全域變數取得點位資料
                const allFeatures = window.allKmlFeatures || (window.mapNamespace ? window.mapNamespace.allKmlFeatures : []);
                
                if (allFeatures.length > 0) {
                    results = allFeatures.filter(feature =>
                        feature.properties && feature.properties.name && 
                        typeof feature.properties.name === 'string' && 
                        feature.properties.name.toLowerCase().includes(query)
                    );
                }

                searchContainer.classList.add('search-active');
                searchResults.style.display = 'grid'; 

                if (results.length === 0) {
                    const noResult = document.createElement('div');
                    noResult.className = 'result-item';
                    noResult.textContent = '沒有找到結果';
                    noResult.style.gridColumn = 'span 3';
                    searchResults.appendChild(noResult);
                } else {
                    // 根據字數調整搜尋清單欄數
                    let maxNameLength = 0;
                    results.forEach(f => {
                        const name = f.properties?.name || '';
                        if (name.length > maxNameLength) maxNameLength = name.length;
                    });
                  
                    searchResults.classList.remove('columns-2', 'columns-3');
                    searchResults.classList.add(maxNameLength > 9 ? 'columns-2' : 'columns-3');

                    // 生成搜尋結果項目
                    results.forEach(f => {
                        const name = f.properties.name || '未命名';
                        if (f.geometry && f.geometry.type === 'Point' && f.geometry.coordinates) {
                            const [lon, lat] = f.geometry.coordinates;
                            const originalLatLng = L.latLng(lat, lon);
                            
                            const item = document.createElement('div');
                            item.className = 'result-item';
                            item.textContent = name;
                            item.title = name;

                            // 點擊搜尋項目 (v2.02 Canvas 相容版)
                            item.addEventListener('click', () => {
                                if (window.map) {
                                    // A. 立即跳轉定位
                                    window.map.setView(originalLatLng, 18);
                            
                                    // B. 同步尋找地圖上的 Canvas Layer (CircleMarker)
                                    window.map.eachLayer((layer) => {
                                        // 在 Canvas 模式下，點位是 L.CircleMarker 而非 L.Marker
                                        if (layer instanceof L.CircleMarker || layer instanceof L.Marker) {
                                            const layerLatLng = layer.getLatLng();
                                            
                                            // 使用距離比對座標 (1公尺內視為同一個點)
                                            if (layerLatLng.distanceTo(originalLatLng) < 1) {
                                                
                                                // 1. 模擬點擊：這會觸發我們在 addGeoJsonLayers 中寫好的高亮與導航按鈕邏輯
                                                layer.fire('click');
                            
                                                // 2. 處理 Canvas 高亮 (直接改樣式，不再操作 DOM span)
                                                if (layer.setStyle) {
                                                    layer.setStyle({
                                                        color: '#ffff00', // 黃色邊框
                                                        weight: 5,        // 邊框加粗
                                                        radius: 12        // 點位放大
                                                    });
                                                }
                                            }
                                        }
                                    });
                                }
                            
                                // 關閉搜尋介面 (保持原樣)
                                searchResults.style.display = 'none';
                                searchBox.value = '';
                                searchContainer.classList.remove('search-active');
                            });
                            searchResults.appendChild(item);
                        }
                    });
                }
            } else {
                searchContainer.classList.remove('search-active');
                searchResults.style.display = 'none';
            }
        });

        // 3. 點擊搜尋框以外區域隱藏結果
        document.addEventListener('click', (event) => {
            if (!searchContainer.contains(event.target)) {
                searchResults.style.display = 'none';
                searchContainer.classList.remove('search-active');
            }
        });

        // 4. 按下 Escape 鍵隱藏
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                searchResults.style.display = 'none';
                searchContainer.classList.remove('search-active');
                searchBox.blur();
            }
        });
    }
});