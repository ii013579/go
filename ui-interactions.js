// ui-interactions.js
document.addEventListener('DOMContentLoaded', () => {
    const editBtn = document.getElementById('editButton');
    const authSec = document.getElementById('authSection');
    const ctrlSec = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');
    const searchRes = document.getElementById('searchResults');
    const searchContainer = document.getElementById('searchContainer');

    // 1. 編輯面板切換 (配合 CSS display: flex)
    editBtn?.addEventListener('click', () => {
        const isHidden = (authSec.style.display === 'none' || authSec.style.display === '');
        if (isHidden) {
            authSec.style.display = 'flex';
            ctrlSec.style.display = 'none';
            editBtn.textContent = '返回';
        } else {
            authSec.style.display = 'none';
            ctrlSec.style.display = 'flex';
            editBtn.textContent = '編輯';
        }
    });

    // 2. 搜尋功能 (配合 CSS .result-item 與 .search-active)
    searchBox?.addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        if (!val || !window.allKmlFeatures) {
            searchRes.style.display = 'none';
            searchContainer.classList.remove('search-active');
            return;
        }

        const matches = window.allKmlFeatures.filter(f => 
            f.properties.name?.toLowerCase().includes(val)
        ).slice(0, 15);

        if (matches.length > 0) {
            searchContainer.classList.add('search-active');
            searchRes.style.display = 'grid'; // 使用 Grid 佈局
            
            // 根據字數長度決定欄數 (選用邏輯)
            searchRes.className = val.length > 4 ? 'columns-2' : 'columns-3';
            
            searchRes.innerHTML = matches.map(f => `<div class="result-item">${f.properties.name}</div>`).join('');
            
            searchRes.querySelectorAll('.result-item').forEach((item, i) => {
                item.onclick = () => {
                    const f = matches[i];
                    const latlng = L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]);
                    
                    window.map.setView(latlng, 18);
                    searchRes.style.display = 'none';
                    searchContainer.classList.remove('search-active');

                    // 尋找對應的 Layer 並觸發點擊以高亮
                    window.map.eachLayer(layer => {
                        if (layer.getTooltip && layer.getTooltip().getContent().includes(f.properties.name)) {
                            layer.fire('click');
                        }
                    });
                };
            });
        } else {
            searchRes.style.display = 'none';
            searchContainer.classList.remove('search-active');
        }
    });
});