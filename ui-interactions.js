// ui-interactions.js v2.02 - 修正語法錯誤與縮放邏輯
document.addEventListener('DOMContentLoaded', () => {
    const editButton = document.getElementById('editButton');
    const authSection = document.getElementById('authSection');
    const controls = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');
    const searchResults = document.getElementById('searchResults');
    const searchContainer = document.getElementById('searchContainer'); 

    if (authSection) authSection.style.display = 'none';
    if (controls) controls.style.display = 'flex';

    // 1. 編輯按鈕邏輯
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
                
                if (window.mapNamespace && window.mapNamespace.allKmlFeatures.length > 0) {
                    window.addGeoJsonLayers(window.mapNamespace.allKmlFeatures);
                }   
            }
        });
    }

    // 2. 搜尋框邏輯
    if (searchBox && searchResults && searchContainer) {
        searchBox.addEventListener('input', async (e) => {
            const query = e.target.value.trim().toLowerCase();
            searchResults.innerHTML = '';

            if (query.length > 0) {
                let results = [];
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
                    // 動態決定欄數
                    let maxNameLength = 0;
                    results.forEach(f => {
                        const name = f.properties?.name || '';
                        if (name.length > maxNameLength) maxNameLength = name.length;
                    });
                  
                    searchResults.classList.remove('columns-2', 'columns-3');
                    searchResults.classList.add(maxNameLength > 9 ? 'columns-2' : 'columns-3');

                    // 生成結果清單
                    results.forEach(f => {
                        const name = f.properties.name || '未命名';
                        if (f.geometry && f.geometry.type === 'Point' && f.geometry.coordinates) {
                            const [lon, lat] = f.geometry.coordinates;
                            const item = document.createElement('div');
                            item.className = 'result-item';
                            item.textContent = name;
                            item.title = name;

                            // 點擊點位
                            item.addEventListener('click', () => {
                                const originalLatLng = L.latLng(lat, lon);
                            
                                if (window.map) {
                                    // 強制跳轉並放大
                                    window.map.setView(originalLatLng, 18);
                            
                                    // 延遲處理 UI 渲染，確保圖層已載入 DOM
                                    setTimeout(() => {
                                        // 清除舊高亮
                                        document.querySelectorAll('.marker-label span').forEach(s => s.classList.remove('label-active'));
                            
                                        window.map.eachLayer((layer) => {
                                            if (layer instanceof L.Marker) {
                                                const layerLatLng = layer.getLatLng();
                                                if (layerLatLng.distanceTo(originalLatLng) < 1) { 
                                                    if (layer.setZIndexOffset) layer.setZIndexOffset(10000);
                                                    layer.openPopup();
                                                    
                                                    const iconInner = layer.getElement();
                                                    if (iconInner) {
                                                        const span = iconInner.querySelector('.marker-label span');
                                                        if (span) span.classList.add('label-active');
                                                    }
                            
                                                    if (typeof window.createNavButton === 'function') {
                                                        window.createNavButton(originalLatLng, name);
                                                    }
                                                }
                                            }
                                        });
                                    }, 150); 
                                }
                            
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

        // 3. 點擊外部隱藏
        document.addEventListener('click', (event) => {
            if (!searchContainer.contains(event.target) && event.target !== searchBox) {
                searchResults.style.display = 'none';
                searchContainer.classList.remove('search-active');
            }
        });

        // 4. ESC 鍵隱藏
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                searchResults.style.display = 'none';
                searchContainer.classList.remove('search-active');
                searchBox.blur();
            }
        });
    }
});