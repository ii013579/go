const searchBox = document.getElementById('searchBox');
const searchResults = document.getElementById('searchResults');
const searchContainer = document.getElementById('searchContainer');

document.getElementById('editButton').onclick = () => {
    const auth = document.getElementById('authSection');
    const ctrl = document.getElementById('controls');
    const isEdit = auth.style.display === 'flex';
    auth.style.display = isEdit ? 'none' : 'flex';
    ctrl.style.display = isEdit ? 'flex' : 'none';
    document.getElementById('editButton').textContent = isEdit ? '編輯' : '關閉';
};

searchBox.oninput = (e) => {
    const val = e.target.value.trim().toLowerCase();
    const results = window.App.allKmlFeatures.filter(f => f.properties.name?.toLowerCase().includes(val));
    searchResults.innerHTML = '';
    if (val && results.length) {
        searchContainer.classList.add('search-active');
        results.slice(0, 10).forEach(f => {
            const item = document.createElement('div');
            item.className = 'search-item';
            item.textContent = f.properties.name;
            item.onclick = () => {
                window.App.map.flyTo([f.geometry.coordinates[1], f.geometry.coordinates[0]], 18);
                searchResults.style.display = 'none';
                searchContainer.classList.remove('search-active');
            };
            searchResults.appendChild(item);
        });
        searchResults.style.display = 'block';
    } else {
        searchResults.style.display = 'none';
        searchContainer.classList.remove('search-active');
    }
};

// 1.9.6 的 ESC 與外部點擊邏輯
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        searchResults.style.display = 'none';
        searchContainer.classList.remove('search-active');
        searchBox.blur();
    }
});

document.addEventListener('click', (e) => {
    if (!searchContainer.contains(e.target)) {
        searchResults.style.display = 'none';
        searchContainer.classList.remove('search-active');
    }
});

document.getElementById('pinButton').onclick = () => {
    const id = document.getElementById('kmlLayerSelect').value;
    const current = localStorage.getItem('pinnedKmlId');
    if (id === current) {
        localStorage.removeItem('pinnedKmlId');
        window.showMessageCustom({ title: '取消釘選', message: '已取消自動載入', autoClose: true });
    } else if (id) {
        localStorage.setItem('pinnedKmlId', id);
        window.showMessageCustom({ title: '釘選成功', message: '已設為預設圖層', autoClose: true });
    }
};

document.getElementById('kmlLayerSelect').onchange = (e) => window.loadKml(e.target.value);