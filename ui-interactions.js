// ui-interactions.js v1.9.6 - 處理 UI 面板切換、搜尋邏輯與圖釘功能
document.addEventListener('DOMContentLoaded', () => {
    // 獲取 UI 元素
    const editBtn = document.getElementById('editButton');
    const authSec = document.getElementById('authSection');
    const ctrlSec = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');
    const searchRes = document.getElementById('searchResults');
    const searchContainer = document.getElementById('searchContainer');
    const pinBtn = document.getElementById('pinButton');

    /**
     * 1. 編輯面板切換 (Flex 佈局對齊)
     * 確保切換時符合 style.css 的 #authSection display: flex 定義
     */
    if (editBtn && authSec && ctrlSec) {
        editBtn.onclick = () => {
            const isAuthHidden = (window.getComputedStyle(authSec).display === 'none');
            if (isAuthHidden) {
                authSec.style.display = 'flex'; // 啟動管理面板
                ctrlSec.style.display = 'none';
                editBtn.textContent = '返回';
                editBtn.style.backgroundColor = '#ffc107';
            } else {
                authSec.style.display = 'none';
                ctrlSec.style.display = 'flex'; // 回到主控制面板
                editBtn.textContent = '編輯';
                editBtn.style.backgroundColor = '';
            }
        };
    }

    /**
     * 2. 圖釘 (Pin) 功能實作
     * 對應 CSS .pin-button-icon.clicked
     */
    if (pinBtn) {
        pinBtn.onclick = () => {
            // 切換紅色背景樣式
            pinBtn.classList.toggle('clicked');
            
            // 實作釘選邏輯：當釘選時，搜尋框內容與地圖標籤高亮不會因為點擊地圖而自動消失
            window.isSearchPinned = pinBtn.classList.contains('clicked');
            console.log("圖釘狀態:", window.isSearchPinned ? "已釘選" : "未釘選");
        };
    }

    /**
     * 3. 搜尋功能與結果三欄排版
     * 整合 map-logic.js 的標籤高亮與導航按鈕觸發
     */
    if (searchBox && searchRes && searchContainer) {
        searchBox.addEventListener('input', (e) => {
            const val = e.target.value.trim().toLowerCase();

            if (!val) {
                searchRes.style.display = 'none';
                searchContainer.classList.remove('search-active');
                return;
            }

            // 從全域變數 window.allKmlFeatures 過濾
            const matches = (window.allKmlFeatures || []).filter(f => 
                f.properties && f.properties.name && f.properties.name.toLowerCase().includes(val)
            ).slice(0, 15);

            if (matches.length > 0) {
                searchContainer.classList.add('search-active');
                searchRes.style.display = 'grid'; // 強制使用 Grid 佈局

                // 生成結果項目 (.result-item)
                searchRes.innerHTML = matches.map(f => `
                    <div class="result-item" title="${f.properties.name}">
                        ${f.properties.name}
                    </div>
                `).join('');

                // 點擊搜尋結果聯動地圖
                searchRes.querySelectorAll('.result-item').forEach((item, index) => {
                    item.onclick = () => {
                        const feature = matches[index];
                        const [lon, lat] = feature.geometry.coordinates;
                        const latlng = L.latLng(lat, lon);
                        const name = feature.properties.name;

                        // 1. 移動視角並縮放
                        window.map.setView(latlng, 18);

                        // 2. 觸發 v1.9.6 標籤高亮 (使用 map-logic.js 的 ID 邏輯)
                        const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');
                        document.querySelectorAll('.marker-label span.label-active').forEach(el => {
                            el.classList.remove('label-active');
                        });
                        const targetLabel = document.getElementById(labelId);
                        if (targetLabel) targetLabel.classList.add('label-active');

                        // 3. 自動開啟導航按鈕 (offroad 圖示)
                        if (window.createNavButton) {
                            window.createNavButton(latlng, name);
                        }

                        // 4. 根據圖釘狀態決定是否隱藏搜尋結果
                        if (!window.isSearchPinned) {
                            searchRes.style.display = 'none';
                            searchContainer.classList.remove('search-active');
                        }
                    };
                });
            } else {
                searchRes.style.display = 'none';
                searchContainer.classList.remove('search-active');
            }
        });
    }

    /**
     * 4. 點擊地圖外部處理
     * 修改 map-logic.js 的點擊邏輯，加入圖釘判斷
     */
    window.map?.on('click', () => {
        if (window.isSearchPinned) return; // 若已釘選，則不清除 UI
        
        if (searchRes) {
            searchRes.style.display = 'none';
            searchContainer.classList.remove('search-active');
        }
        if (searchBox) searchBox.value = '';
        
        document.querySelectorAll('.marker-label span.label-active').forEach(el => {
            el.classList.remove('label-active');
        });
        window.navButtons?.clearLayers(); // 清除導航按鈕
    });
});