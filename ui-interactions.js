// ui-interactions.js
document.addEventListener('DOMContentLoaded', () => {
    const editBtn = document.getElementById('editButton');
    const authSec = document.getElementById('authSection');
    const ctrlSec = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');
    const searchRes = document.getElementById('searchResults');
    const searchContainer = document.getElementById('searchContainer');

    // 面板切換 (配合 CSS display: flex)
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

    // 搜尋與高亮邏輯
    searchBox?.addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        if (!val) {
            searchRes.style.display = 'none';
            searchContainer.classList.remove('search-active');
            return;
        }

        const matches = window.allKmlFeatures.filter(f => f.properties.name?.toLowerCase().includes(val));
        if (matches.length > 0) {
            searchContainer.classList.add('search-active');
            searchRes.style.display = 'grid'; // 配合 CSS grid 佈局
            searchRes.innerHTML = matches.map(f => `<div class="result-item">${f.properties.name}</div>`).join('');
            
            searchRes.querySelectorAll('.result-item').forEach((item, idx) => {
                item.onclick = () => {
                    const f = matches[idx];
                    const latlng = L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]);
                    window.map.setView(latlng, 18);
                    searchRes.style.display = 'none';
                    searchContainer.classList.remove('search-active');
                    // 觸發地圖上的點擊（以高亮標籤）
                    window.map.eachLayer(l => {
                        if (l.getTooltip && l.getTooltip().getContent().includes(f.properties.name)) {
                            l.fire('click');
                        }
                    });
                };
            });
        }
    });
});