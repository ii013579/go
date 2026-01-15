// ui-interactions.js v2.0.0
document.addEventListener('DOMContentLoaded', () => {
    const editButton = document.getElementById('editButton');
    const authSection = document.getElementById('authSection');
    const controls = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');
    const searchResults = document.getElementById('searchResults');

    // 1. 管理介面切換
    editButton?.addEventListener('click', () => {
        if (authSection.style.display === 'none') {
            authSection.style.display = 'block';
            controls.style.display = 'none';
            editButton.textContent = '返回';
        } else {
            authSection.style.display = 'none';
            controls.style.display = 'flex';
            editButton.textContent = '編輯';
        }
    });

    // 2. 搜尋連動清查功能
    searchBox?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query || !window.allKmlFeatures) {
            searchResults.style.display = 'none';
            return;
        }

        const matches = window.allKmlFeatures.filter(f => 
            f.properties?.name?.toLowerCase().includes(query)
        ).slice(0, 10);

        if (matches.length > 0) {
            searchResults.innerHTML = matches.map(f => `
                <div class="search-item" data-name="${f.properties.name}">${f.properties.name}</div>
            `).join('');
            searchResults.style.display = 'block';

            // 綁定點擊搜尋結果
            document.querySelectorAll('.search-item').forEach((item, idx) => {
                item.onclick = () => {
                    const feature = matches[idx];
                    const coords = feature.geometry.coordinates;
                    const latlng = [coords[1], coords[0]];
                    
                    window.map.setView(latlng, 18);
                    searchResults.style.display = 'none';
                    searchBox.value = '';

                    // 重要：搜尋後直接彈出清查面板
                    if (window.openSurveyPanel) {
                        window.openSurveyPanel(feature, L.latLng(latlng));
                    }
                };
            });
        } else {
            searchResults.style.display = 'none';
        }
    });

    // 3. 圖釘狀態初次檢查
    setTimeout(() => {
        const pinnedId = localStorage.getItem('pinnedKmlId');
        if (pinnedId) document.getElementById('pinButton').style.color = '#ffeb3b';
    }, 1000);
});