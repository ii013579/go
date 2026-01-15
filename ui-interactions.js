document.addEventListener('DOMContentLoaded', () => {
    const editBtn = document.getElementById('editButton');
    const authSec = document.getElementById('authSection');
    const ctrlSec = document.getElementById('controls');

    editBtn?.addEventListener('click', () => {
        // 重要：配合 v1.9.6 CSS，管理面板必須是 flex
        if (authSec.style.display === 'none' || authSec.style.display === '') {
            authSec.style.display = 'flex';
            ctrlSec.style.display = 'none';
            editBtn.textContent = '關閉';
        } else {
            authSec.style.display = 'none';
            ctrlSec.style.display = 'flex';
            editBtn.textContent = '編輯';
        }
    });

    // 搜尋功能與 1.9.6 一致
    const box = document.getElementById('searchBox');
    const res = document.getElementById('searchResults');
    box?.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        if(!val) { res.style.display = 'none'; return; }
        const matches = (window.allKmlFeatures || []).filter(f => f.properties.name.toLowerCase().includes(val)).slice(0, 10);
        res.innerHTML = matches.map(f => `<div class="search-item">${f.properties.name}</div>`).join('');
        res.style.display = matches.length ? 'block' : 'none';
        
        res.querySelectorAll('.search-item').forEach((div, i) => {
            div.onclick = () => {
                const f = matches[i];
                const latlng = L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]);
                window.map.setView(latlng, 18);
                res.style.display = 'none';
                if(window.openSurveyPanel) window.openSurveyPanel(f, latlng);
            };
        });
    });
});