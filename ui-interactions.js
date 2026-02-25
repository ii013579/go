// ui-interactions.js v2.01

document.addEventListener('DOMContentLoaded', () => {
    const editButton = document.getElementById('editButton');
    const authSection = document.getElementById('authSection');
    const controls = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');
    const searchResults = document.getElementById('searchResults');
    const searchContainer = document.getElementById('searchContainer'); 

    authSection.style.display = 'none';
    controls.style.display = 'flex';

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
                authSection.style.display = 'flex'; // 修正拼寫: displaay -> display
                editButton.textContent = '關閉';
                
                if (window.mapNamespace && window.mapNamespace.allKmlFeatures.length > 0) {
                    window.addGeoJsonLayers(window.mapNamespace.allKmlFeatures);
                }   
            }
        });
    } else {
        console.error('錯誤: 找不到編輯按鈕、認證區塊或控制項。');
    }

    // 2. 搜尋框邏輯
    if (searchBox && searchResults && searchContainer) {
        searchBox.addEventListener('input', async (e) => {
            const query = e.target.value.trim().toLowerCase();
            searchResults.innerHTML = '';

            if (query.length > 0) {
                let results = [];
                if (window.allKmlFeatures && window.allKmlFeatures.length > 0) {
                    results = window.allKmlFeatures.filter(feature =>
                        feature.properties && feature.properties.name && typeof feature.properties.name === 'string' && feature.properties.name.toLowerCase().includes(query)
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
                    let maxNameLength = 0;
                    results.forEach(f => {
                      const name = f.properties?.name || '';
                      if (name.length > maxNameLength) maxNameLength = name.length;
                    });
                  
                    searchResults.classList.remove('columns-2', 'columns-3');
                    searchResults.classList.add(maxNameLength > 9 ? 'columns-2' : 'columns-3');

                    results.forEach(f => {
                        const name = f.properties.name || '未命名';
                        if (f.geometry && f.geometry.type === 'Point' && f.geometry.coordinates) {
                            const [lon, lat] = f.geometry.coordinates;
                            const item = document.createElement('div');
                            item.className = 'result-item';
                            item.textContent = name;
                            item.title = name;
                            item.addEventListener('click', () => {
                                const [lon, lat] = f.geometry.coordinates;
                                const originalLatLng = L.latLng(lat, lon);
                                const name = f.properties.name || "未命名點位";
                            
                                if (window.map) {
                                    // 1. 強制放大到 18 倍（以前最穩定的方式）
                                    window.map.setView(originalLatLng, 18);
                            
                                    // 2. ✨ 關鍵：使用 setTimeout 延遲 100 毫秒
                                    // 確保地圖 view 設定完成後，Markers 已經出現在 DOM 中
                                    setTimeout(() => {
                                        // 清除舊的高亮
                                        document.querySelectorAll('.marker-label span').forEach(s => s.classList.remove('label-active'));
                            
                                        window.map.eachLayer((layer) => {
                                            if (layer instanceof L.Marker) {
                                                const layerLatLng = layer.getLatLng();
                                                // 判斷距離，找出被點擊的那個點
                                                if (layerLatLng.distanceTo(originalLatLng) < 1) { 
                                                    // A. 提升 z-index
                                                    if (layer.setZIndexOffset) layer.setZIndexOffset(10000);
                                                    
                                                    // B. 打開彈窗
                                                    layer.openPopup();
                                                    
                                                    // C. 加上高亮藍字
                                                    const iconInner = layer.getElement();
                                                    if (iconInner) {
                                                        const span = iconInner.querySelector('.marker-label span');
                                                        if (span) span.classList.add('label-active');
                                                    }
                            
                                                    // D. 產生導航按鈕
                                                    if (typeof window.createNavButton === 'function') {
                                                        window.createNavButton(originalLatLng, name);
                                                    }
                                                }
                                            }
                                        });
                                    }, 100); // 100ms 剛好是肉眼感覺不到但程式能反應的時間
                                }
                            
                                searchResults.style.display = 'none';
                                searchBox.value = '';
                                searchContainer.classList.remove('search-active');
                            });

        // 3. 點擊外部隱藏
        document.addEventListener('click', (event) => {
            if (!searchResults.contains(event.target) && event.target !== searchBox && !searchContainer.contains(event.target)) {
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