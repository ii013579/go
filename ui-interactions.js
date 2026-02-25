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
                                const originalLatLng = L.latLng(lat, lon);
                                if (window.map) {
                                    window.map.setView(originalLatLng, 18);
                                    
                                        window.map.eachLayer((layer) => {
                                        if (layer instanceof L.Marker && layer.getLatLng().equals(originalLatLng)) {
                                           if (layer.setZIndexOffset) layer.setZIndexOffset(2000);
                                           Layer.openPopup();
                                       }
                                    });
                                }

                                document.querySelectorAll('.marker-label span').forEach(el => el.classList.remove('label-active'));
                                const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');
                                const target = document.getElementById(labelId);
                                if (target) target.classList.add('label-active');
                                
                                if (typeof window.createNavButton === 'function') {
                                    window.createNavButton(originalLatLng, name);
                                }
                                searchResults.style.display = 'none';
                                searchBox.value = '';
                                searchContainer.classList.remove('search-active');
                            });
                            searchResults.appendChild(item); // 補上這行，將項目加入列表
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