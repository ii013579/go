// ui-interactions.js v2.1
document.addEventListener('DOMContentLoaded', () => {
    const searchBox = document.getElementById('searchBox');
    const results = document.getElementById('searchResults');
    const container = document.getElementById('searchContainer');

    if (searchBox) {
        searchBox.oninput = (e) => {
            const query = e.target.value.toLowerCase();
            if (!query) {
                results.style.display = 'none';
                container.classList.remove('search-active');
                return;
            }

            const matches = window.allKmlFeatures.filter(f => f.properties.name.toLowerCase().includes(query));
            if (matches.length > 0) {
                container.classList.add('search-active'); // 使搜尋框底變直角
                results.style.display = 'grid'; // 套用 CSS 三欄佈局
                results.innerHTML = matches.map(f => `
                    <div class="result-item" onclick="handleSearchSelect('${f.properties.name}', ${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]})">
                        ${f.properties.name}
                    </div>
                `).join('');
            }
        };
    }
});

window.handleSearchSelect = function(name, lat, lon) {
    const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');
    window.createNavButton([lat, lon], name, labelId); // 觸發高亮與導航
    map.setView([lat, lon], 18);
};