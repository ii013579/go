document.addEventListener('DOMContentLoaded', () => {
    const editButton = document.getElementById('editButton');
    const authSection = document.getElementById('authSection');
    const controls = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');
    const searchResults = document.getElementById('searchResults');

    // 切換管理面板：配合 v1.9.6 CSS 使用 flex
    editButton?.addEventListener('click', () => {
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

    // 搜尋功能連動清查
    searchBox?.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        if (!val || !window.allKmlFeatures) {
            searchResults.style.display = 'none';
            return;
        }

        const matches = window.allKmlFeatures.filter(f => 
            f.properties?.name?.toLowerCase().includes(val)
        ).slice(0, 10);

        if (matches.length > 0) {
            searchResults.innerHTML = matches.map(f => `<div class="search-item">${f.properties.name}</div>`).join('');
            searchResults.style.display = 'block';

            searchResults.querySelectorAll('.search-item').forEach((item, i) => {
                item.onclick = () => {
                    const f = matches[i];
                    const latlng = L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]);
                    window.map.setView(latlng, 18);
                    searchResults.style.display = 'none';
                    searchBox.value = '';
                    if (window.openSurveyPanel) window.openSurveyPanel(f, latlng);
                };
            });
        } else {
            searchResults.style.display = 'none';
        }
    });
});