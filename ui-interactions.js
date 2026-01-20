// ui-interactions.js v2.1
// 處理面板切換與三欄搜尋邏輯

document.addEventListener('DOMContentLoaded', () => {
    const editButton = document.getElementById('editButton');
    const authSection = document.getElementById('authSection');
    const controls = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');
    const searchResults = document.getElementById('searchResults');
    const searchContainer = document.getElementById('searchContainer');

    // 1. 修復編輯按鈕點擊 (解決 display 初始判斷問題)
    if (editButton && authSection && controls) {
        editButton.onclick = () => {
            const currentDisplay = window.getComputedStyle(authSection).display;
            if (currentDisplay === 'none') {
                authSection.style.display = 'flex';
                controls.style.display = 'none';
                editButton.textContent = '關閉';
                editButton.style.backgroundColor = '#ffc107';
            } else {
                authSection.style.display = 'none';
                controls.style.display = 'flex';
                editButton.textContent = '編輯';
                editButton.style.backgroundColor = '';
            }
        };
    }

    // 2. 搜尋功能邏輯
    if (searchBox && searchResults) {
        searchBox.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            
            if (!query) {
                searchResults.style.display = 'none';
                searchContainer?.classList.remove('search-active');
                return;
            }

            // 過濾 allKmlFeatures (由 map-logic.js 維護)
            const matches = window.allKmlFeatures.filter(f => 
                f.properties.name.toLowerCase().includes(query)
            ).slice(0, 15);

            if (matches.length > 0) {
                searchContainer?.classList.add('search-active');
                searchResults.style.display = 'grid'; // 確保為三欄佈局
                
                searchResults.innerHTML = matches.map(f => `
                    <div class="result-item" onclick="window.handleSearchClick('${f.properties.name}', ${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]})">
                        ${f.properties.name}
                    </div>
                `).join('');
            } else {
                searchResults.style.display = 'none';
                searchContainer?.classList.remove('search-active');
            }
        });
    }
});

/**
 * 處理搜尋結果點擊
 */
window.handleSearchClick = function(name, lat, lon) {
    const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');
    
    // 呼叫 map-logic 的核心功能
    if (window.activatePointLogic) {
        window.activatePointLogic([lat, lon], name, labelId);
        window.map.setView([lat, lon], 18);
    }

    // 關閉搜尋面板
    const results = document.getElementById('searchResults');
    const container = document.getElementById('searchContainer');
    if (results) results.style.display = 'none';
    if (container) container.classList.remove('search-active');
};