// ui-interactions.js v2.0.0
document.addEventListener('DOMContentLoaded', () => {
    const editButton = document.getElementById('editButton');
    const authSection = document.getElementById('authSection');
    const controls = document.getElementById('controls');

    // 切換編輯模式 (配合 v1.9.6 CSS 的 Flex 屬性)
    editButton?.addEventListener('click', () => {
        if (authSection.style.display === 'none' || authSection.style.display === '') {
            authSection.style.display = 'flex'; // 必須是 flex
            controls.style.display = 'none';
            editButton.textContent = '關閉';
        } else {
            authSection.style.display = 'none';
            controls.style.display = 'flex';
            editButton.textContent = '編輯';
        }
    });

    // 搜尋連動邏輯
    const searchBox = document.getElementById('searchBox');
    const searchResults = document.getElementById('searchResults');

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
            
            // 點擊搜尋結果
            searchResults.querySelectorAll('.search-item').forEach((div, i) => {
                div.onclick = () => {
                    const f = matches[i];
                    const latlng = L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]);
                    window.map.setView(latlng, 18);
                    searchResults.style.display = 'none';
                    if (window.openSurveyPanel) window.openSurveyPanel(f, latlng);
                };
            });
        }
    });
});