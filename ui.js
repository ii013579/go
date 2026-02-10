/**
 * 檔名：ui.js
 * 版本：v2.1.0
 * 權責：介面互動控制、搜尋過濾邏輯、側邊欄切換
 * 功能：
 * - 處理搜尋框 (searchBox) 的輸入過濾與地圖連動
 * - 處理側邊欄 (編輯按鈕) 的顯示與隱藏
 * - 處理 ESC 鍵關閉搜尋結果
 * - 連接 KML 選單切換至資料載入函式
 */

// 1. 搜尋功能邏輯
const searchBox = document.getElementById('searchBox');
const searchResults = document.getElementById('searchResults');

if (searchBox) {
    searchBox.oninput = (e) => {
        const val = e.target.value.trim().toLowerCase();
        // 從 window.App.allKmlFeatures 過濾
        const filtered = window.App.allKmlFeatures.filter(f => 
            f.properties && f.properties.name && f.properties.name.toLowerCase().includes(val)
        );

        searchResults.innerHTML = '';
        if (val && filtered.length > 0) {
            filtered.slice(0, 10).forEach(f => {
                const div = document.createElement('div');
                div.className = 'search-item';
                div.style.padding = '8px';
                div.style.cursor = 'pointer';
                div.style.borderBottom = '1px solid #eee';
                div.textContent = f.properties.name;
                
                div.onclick = () => {
                    const lat = f.geometry.coordinates[1];
                    const lng = f.geometry.coordinates[0];
                    window.App.map.flyTo([lat, lng], 18);
                    searchResults.style.display = 'none';
                    searchBox.value = f.properties.name;
                };
                searchResults.appendChild(div);
            });
            searchResults.style.display = 'block';
        } else {
            searchResults.style.display = 'none';
        }
    };
}

// 2. 鍵盤事件：按下 ESC 關閉搜尋
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (searchResults) searchResults.style.display = 'none';
        if (searchBox) searchBox.blur();
    }
});

// 3. 側邊欄/編輯面板切換 (恢復 v1.9.6 邏輯)
const editButton = document.getElementById('editButton');
if (editButton) {
    editButton.onclick = () => {
        const authSection = document.getElementById('authSection');
        const controls = document.getElementById('controls');
        
        // 切換顯示狀態
        if (authSection.style.display === 'none' || authSection.style.display === '') {
            authSection.style.display = 'flex';
            controls.style.display = 'none';
            editButton.textContent = '關閉';
        } else {
            authSection.style.display = 'none';
            controls.style.display = 'flex';
            editButton.textContent = '編輯';
        }
    };
}

// 4. KML 選單切換連動
const kmlSelect = document.getElementById('kmlLayerSelect');
if (kmlSelect) {
    kmlSelect.onchange = (e) => {
        const selectedId = e.target.value;
        if (selectedId && window.loadKml) {
            window.loadKml(selectedId);
            // 自動儲存至 localStorage (釘選功能)
            localStorage.setItem('pinnedKmlId', selectedId);
        }
    };
}

console.log("UI Module Loaded");