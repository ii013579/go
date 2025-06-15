// ui-interactions.js

document.addEventListener('DOMContentLoaded', () => {
    const editButton = document.getElementById('editButton');
    const authSection = document.getElementById('authSection');
    const controls = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');
    const searchResults = document.getElementById('searchResults');
    const searchContainer = document.getElementById('searchContainer'); // 獲取搜尋容器
    const userManagementSection = document.getElementById('userManagementSection');
    const refreshUsersBtn = document.getElementById('refreshUsersBtn'); // 開關的按鈕

    authSection.style.display = 'none';
    controls.style.display = 'flex';

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
            }
        });
    } else {
        console.error('錯誤: 找不到編輯按鈕、認證區塊或控制項。');
    }

    // 新增：控制使用者管理區塊的顯示/隱藏
    if (userManagementSection && refreshUsersBtn) {
        // 預設使用者管理區塊是開啟的 (顯示)
        userManagementSection.style.display = 'block'; // 使用 'block' 適合 div 元素

        // 綁定點擊事件來切換顯示狀態
        refreshUsersBtn.addEventListener('click', () => {
            const isUserManagementVisible = userManagementSection.style.display === 'block';
            if (isUserManagementVisible) {
                userManagementSection.style.display = 'none'; // 隱藏
                refreshUsersBtn.textContent = '使用者管理 (已關閉)'; // 修改按鈕文字
            } else {
                userManagementSection.style.display = 'block'; // 顯示
                refreshUsersBtn.textContent = '使用者管理 (已開啟)'; // 修改按鈕文字
            }
        });

        // 頁面載入時，更新按鈕文字以反映預設開啟狀態
        refreshUsersBtn.textContent = '使用者管理 (已開啟)';
    } else {
        console.error('錯誤: 找不到使用者管理區塊或重新整理使用者按鈕。');
    }


    // 監聽搜尋框的輸入事件
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

                // 當搜尋結果顯示時，為 searchContainer 添加活躍狀態類別
                searchContainer.classList.add('search-active');

                searchResults.style.display = 'grid'; // 顯示為 grid

                if (results.length === 0) {
                    const noResult = document.createElement('div');
                    noResult.className = 'result-item';
                    noResult.textContent = '沒有找到結果';
                    // 讓「沒有找到結果」訊息橫跨三欄
                    noResult.style.gridColumn = 'span 3';
                    searchResults.appendChild(noResult);
                } else {
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
                                map.setView(originalLatLng, 16);
                                window.createNavButton(originalLatLng, name);
                                searchResults.style.display = 'none';
                                searchBox.value = '';
                                // 當搜尋結果隱藏時，移除 searchContainer 的活躍狀態類別
                                searchContainer.classList.remove('search-active');
                                console.log(`點擊搜尋結果: ${name}，縮放至地圖。`);
                            });
                            searchResults.appendChild(item);
                        } else {
                            console.warn("跳過非 Point 類型或無座標的 feature 進行搜尋:", f);
                        }
                    });
                }
            } else {
                searchResults.style.display = 'none';
                // 當搜尋結果隱藏時，移除 searchContainer 的活躍狀態類別
                searchContainer.classList.remove('search-active');
            }
        });

        // 點擊搜尋結果框外部時隱藏搜尋結果
        document.addEventListener('click', (event) => {
            // 檢查點擊是否在 searchResults 內部，或者在 searchBox 內部，或者在 searchContainer 內部
            if (!searchResults.contains(event.target) && event.target !== searchBox && !searchContainer.contains(event.target)) {
                searchResults.style.display = 'none';
                searchContainer.classList.remove('search-active'); // 移除活躍狀態類別
            }
        });

        // 監聽 ESC 鍵以隱藏搜尋結果
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                searchResults.style.display = 'none';
                searchContainer.classList.remove('search-active'); // 移除活躍狀態類別
                searchBox.blur();
            }
        });
    }
});