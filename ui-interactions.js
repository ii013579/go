// ui-interactions.js v2.0.0
// 職責：服務台 (介面切換、即時搜尋、對接全域彈窗)

document.addEventListener('DOMContentLoaded', () => {
    const editButton = document.getElementById('editButton');
    const authSection = document.getElementById('authSection');
    const controls = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');
    const searchResults = document.getElementById('searchResults');
    const searchContainer = document.getElementById('searchContainer');

    // 1. 介面初始狀態
    if (authSection) authSection.style.display = 'none';
    if (controls) controls.style.display = 'flex';

    // --- 2. 編輯模式切換 (清查功能入口) ---
    if (editButton && authSection && controls) {
        editButton.addEventListener('click', () => {
            const isAuthSectionVisible = authSection.style.display === 'flex';
            if (isAuthSectionVisible) {
                // 關閉管理模式，切換回一般導覽
                authSection.style.display = 'none';
                controls.style.display = 'flex';
                editButton.textContent = '編輯';
                editButton.classList.remove('active');
            } else {
                // 開啟管理/登入模式
                controls.style.display = 'none';
                authSection.style.display = 'flex';
                editButton.textContent = '關閉';
                editButton.classList.add('active');
            }
        });
    }

    // --- 3. 搜尋功能 (與 map-logic 共享 window.allKmlFeatures) ---
    if (searchBox && searchResults && searchContainer) {
        searchBox.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            searchResults.innerHTML = '';

            if (query.length > 0) {
                let results = [];
                // 核心：直接使用指揮官抓下來的快取資料，不重複向 Firebase 請求
                if (window.allKmlFeatures && window.allKmlFeatures.length > 0) {
                    results = window.allKmlFeatures.filter(feature =>
                        feature.properties && 
                        feature.properties.name && 
                        typeof feature.properties.name === 'string' && 
                        feature.properties.name.toLowerCase().includes(query)
                    );
                }

                searchContainer.classList.add('search-active');
                searchResults.style.display = 'grid';

                if (results.length === 0) {
                    const noResult = document.createElement('div');
                    noResult.className = 'result-item no-result';
                    noResult.textContent = '沒有找到清查結果';
                    noResult.style.gridColumn = 'span 3';
                    searchResults.appendChild(noResult);
                } else {
                    // 動態計算欄數 (美化介面)
                    let maxNameLength = 0;
                    results.forEach(f => {
                        const name = f.properties?.name || '';
                        if (name.length > maxNameLength) maxNameLength = name.length;
                    });
                    
                    searchResults.classList.remove('columns-2', 'columns-3');
                    searchResults.classList.add(maxNameLength > 9 ? 'columns-2' : 'columns-3');

                    results.forEach(f => {
                        const name = f.properties.name || '未命名';
                        if (f.geometry && f.geometry.type === 'Point') {
                            const [lon, lat] = f.geometry.coordinates;
                            const item = document.createElement('div');
                            item.className = 'result-item';
                            item.textContent = name;
                            item.title = name;
                            
                            // 搜尋結果點擊連動
                            item.addEventListener('click', () => {
                                const latLng = L.latLng(lat, lon);
                                
                                // 1. 移動地圖
                                if (window.map) {
                                    window.map.setView(latLng, 18);
                                }
                            
                                // 2. 高亮地圖上的標籤
                                document.querySelectorAll('.marker-label span').forEach(el =>
                                    el.classList.remove('label-active')
                                );
                                const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');
                                const targetLabel = document.getElementById(labelId);
                                if (targetLabel) targetLabel.classList.add('label-active');
                            
                                // 3. 觸發導航/清查詳細資訊
                                if (typeof window.createNavButton === 'function') {
                                    window.createNavButton(latLng, name);
                                }
                                
                                // 4. 收合搜尋框
                                searchResults.style.display = 'none';
                                searchBox.value = '';
                                searchContainer.classList.remove('search-active');
                            });
                            searchResults.appendChild(item);
                        }
                    });
                }
            } else {
                searchResults.style.display = 'none';
                searchContainer.classList.remove('search-active');
            }
        });

        // 點擊外部自動收合
        document.addEventListener('click', (event) => {
            if (!searchContainer.contains(event.target)) {
                searchResults.style.display = 'none';
                searchContainer.classList.remove('search-active');
            }
        });

        // ESC 鍵快速關閉
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchResults.style.display = 'none';
                searchContainer.classList.remove('search-active');
                searchBox.blur();
            }
        });
    }
});

// --- 4. 對接系統全域函式 ---

/**
 * 進階訊息視窗 (支援釘選成功後的自動消失)
 */
window.showMessageCustom = function(options) {
    const { title, message, autoClose = false, autoCloseDelay = 3000 } = options;
    
    // 使用 firebase-init.js 定義的基礎彈窗
    if (typeof window.showMessage === 'function') {
        window.showMessage(title, message);
    } else {
        console.log(`[${title}] ${message}`);
    }

    // 如果開啟自動關閉 (例如用於「圖釘釘選成功」)
    if (autoClose && typeof window.hideMessage === 'function') {
        setTimeout(() => {
            window.hideMessage();
        }, autoCloseDelay);
    }
};

/**
 * 確認對話框 (支援上傳覆蓋前的確認)
 * @returns {Promise<boolean>}
 */
window.showConfirmationModal = function(title, message) {
    return new Promise((resolve) => {
        // 這裡可以使用漂亮的 Modal 替換原生 confirm
        const result = confirm(`${title}\n\n${message}`);
        resolve(result);
    });
};