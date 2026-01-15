document.addEventListener('DOMContentLoaded', () => {
    const editButton = document.getElementById('editButton');
    const authSection = document.getElementById('authSection');
    const controls = document.getElementById('controls');

    editButton?.addEventListener('click', () => {
        // 配合 v1.9.6 CSS 的 Flex 切換
        if (authSection.style.display === 'none' || authSection.style.display === '') {
            authSection.style.display = 'flex'; 
            controls.style.display = 'none';
            editButton.textContent = '關閉';
        } else {
            authSection.style.display = 'none';
            controls.style.display = 'flex';
            editButton.textContent = '編輯';
        }
    });

    // 搜尋連動
    const searchBox = document.getElementById('searchBox');
    const results = document.getElementById('searchResults');
    searchBox?.addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        if(!val) { results.style.display = 'none'; return; }
        const matches = (window.allKmlFeatures || []).filter(f => f.properties.name.toLowerCase().includes(val)).slice(0, 10);
        results.innerHTML = matches.map(f => `<div class="search-item">${f.properties.name}</div>`).join('');
        results.style.display = matches.length ? 'block' : 'none';
        
        results.querySelectorAll('.search-item').forEach((item, i) => {
            item.onclick = () => {
                const f = matches[i];
                const latlng = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
                window.map.setView(latlng, 18);
                results.style.display = 'none';
                if(window.openSurveyPanel) window.openSurveyPanel(f, L.latLng(latlng));
            };
        });
    });
});