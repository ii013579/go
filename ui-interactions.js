// ui-interactions.js v1.9.6 完整邏輯版

document.addEventListener('DOMContentLoaded', () => {
    // 獲取 UI 元素
    const editBtn = document.getElementById('editButton');
    const authSec = document.getElementById('authSection');
    const ctrlSec = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');
    const searchRes = document.getElementById('searchResults');
    const searchContainer = document.getElementById('searchContainer');

    /**
     * 1. 編輯面板切換邏輯
     * 配合 CSS：#authSection 與 #controls 預設使用 flex 佈局
     */
    if (editBtn && authSec && ctrlSec) {
        editBtn.addEventListener('click', () => {
            // 檢查目前是否為隱藏狀態（對應 CSS 預設 display: none）
            const isAuthHidden = (window.getComputedStyle(authSec).display === 'none');

            if (isAuthHidden) {
                // 開啟管理面板
                authSec.style.display = 'flex';   // 必須為 flex 才能讓內部按鈕正確排列
                ctrlSec.style.display = 'none';
                editBtn.textContent = '返回';
                editBtn.style.backgroundColor = '#ffc107'; // 變換顏色提示切換
            } else {
                // 返回主控制面板
                authSec.style.display = 'none';
                ctrlSec.style.display = 'flex';
                editBtn.textContent = '編輯';
                editBtn.style.backgroundColor = '#f0f0f0';
            }
        });
    }

    /**
     * 2. 搜尋功能與結果排版
     * 配合 CSS：.result-item, .search-active, .columns-3
     */
    if (searchBox && searchRes && searchContainer) {
        searchBox.addEventListener('input', (e) => {
            const val = e.target.value.trim().toLowerCase();

            // 若輸入為空，隱藏結果視窗
            if (!val) {
                searchRes.style.display = 'none';
                searchContainer.classList.remove('search-active');
                return;
            }

            // 從全域變數 window.allKmlFeatures 過濾資料
            const matches = (window.allKmlFeatures || []).filter(f => 
                f.properties && f.properties.name && f.properties.name.toLowerCase().includes(val)
            ).slice(0, 15); // 最多顯示 15 筆

            if (matches.length > 0) {
                // 顯示結果並套用 CSS 激活樣式
                searchContainer.classList.add('search-active');
                searchRes.style.display = 'grid'; // 確保使用 Grid 佈局

                // 根據關鍵字長度動態調整欄數（對應 CSS .columns-2 / .columns-3）
                if (val.length > 4) {
                    searchRes.classList.remove('columns-3');
                    searchRes.classList.add('columns-2');
                } else {
                    searchRes.classList.remove('columns-2');
                    searchRes.classList.add('columns-3');
                }

                // 產生結果 HTML
                searchRes.innerHTML = matches.map(f => `
                    <div class="result-item" title="${f.properties.name}">
                        ${f.properties.name}
                    </div>
                `).join('');

                // 綁定點擊搜尋結果事件
                searchRes.querySelectorAll('.result-item').forEach((item, index) => {
                    item.onclick = () => {
                        const targetFeature = matches[index];
                        const coords = targetFeature.geometry.coordinates;
                        const latlng = L.latLng(coords[1], coords[0]);

                        // 1. 移動地圖
                        window.map.setView(latlng, 18);

                        // 2. 關閉搜尋視窗
                        searchRes.style.display = 'none';
                        searchContainer.classList.remove('search-active');
                        searchBox.value = targetFeature.properties.name;

                        // 3. 觸發地圖上的 Marker 點擊事件（以啟動高亮與清查面板）
                        if (window.focusOnFeatureByName) {
                            window.focusOnFeatureByName(targetFeature.properties.name);
                        }
                    };
                });
            } else {
                searchRes.style.display = 'none';
                searchContainer.classList.remove('search-active');
            }
        });

        // 點擊地圖其他地方時關閉搜尋結果
        document.addEventListener('click', (e) => {
            if (!searchContainer.contains(e.target)) {
                searchRes.style.display = 'none';
                searchContainer.classList.remove('search-active');
            }
        });
    }
});

/**
 * 3. 訊息提示視窗工具 (對應 CSS .message-box-overlay)
 */
window.showMessage = function(title, message) {
    const overlay = document.createElement('div');
    overlay.className = 'message-box-overlay visible';
    overlay.innerHTML = `
        <div class="message-box-content">
            <h3>${title}</h3>
            <p>${message}</p>
            <button onclick="this.parentElement.parentElement.remove()">確定</button>
        </div>
    `;
    document.body.appendChild(overlay);
};