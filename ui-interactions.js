// ui-interactions.js v2.0.0 (修復版)
document.addEventListener('DOMContentLoaded', () => {
    const editBtn = document.getElementById('editButton');
    const authSec = document.getElementById('authSection');
    const ctrlSec = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');
    const searchRes = document.getElementById('searchResults');

    // 切換管理面板：配合 style.css 使用 flex
    editBtn?.addEventListener('click', () => {
        const isHidden = (authSec.style.display === 'none' || authSec.style.display === '');
        if (isHidden) {
            authSec.style.display = 'flex'; // 關鍵：flex 才能讓內容正確排列
            ctrlSec.style.display = 'none';
            editBtn.textContent = '返回';
        } else {
            authSec.style.display = 'none';
            ctrlSec.style.display = 'flex';
            editBtn.textContent = '編輯';
        }
    });

    // 搜尋功能
    searchBox?.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        if (!val || !window.allKmlFeatures) {
            searchRes.style.display = 'none';
            return;
        }

        const matches = window.allKmlFeatures.filter(f => 
            f.properties.name?.toLowerCase().includes(val)
        ).slice(0, 10);

        if (matches.length > 0) {
            searchRes.innerHTML = matches.map(f => `<div class="search-item">${f.properties.name}</div>`).join('');
            searchRes.style.display = 'block';

            searchRes.querySelectorAll('.search-item').forEach((div, i) => {
                div.onclick = () => {
                    const f = matches[i];
                    const latlng = L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]);
                    window.map.setView(latlng, 18);
                    searchRes.style.display = 'none';
                    if (window.openSurveyPanel) window.openSurveyPanel(f, latlng);
                };
            });
        } else {
            searchRes.style.display = 'none';
        }
    });
});