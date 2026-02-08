document.getElementById('editButton').onclick = () => {
    const isEdit = document.getElementById('authSection').style.display === 'flex';
    document.getElementById('authSection').style.display = isEdit ? 'none' : 'flex';
    document.getElementById('controls').style.display = isEdit ? 'flex' : 'none';
    document.getElementById('editButton').textContent = isEdit ? '編輯' : '關閉';
};

document.getElementById('searchBox').oninput = (e) => {
    const val = e.target.value.toLowerCase();
    const res = window.App.allFeatures.filter(f => f.properties.name?.toLowerCase().includes(val));
    const box = document.getElementById('searchResults');
    box.innerHTML = '';
    res.slice(0, 10).forEach(f => {
        const d = document.createElement('div');
        d.className = 'search-item';
        d.textContent = f.properties.name;
        d.onclick = () => {
            window.App.map.flyTo([f.geometry.coordinates[1], f.geometry.coordinates[0]], 18);
            box.style.display = 'none';
        };
        box.appendChild(d);
    });
    box.style.display = res.length ? 'block' : 'none';
};

document.getElementById('pinButton').onclick = () => {
    const id = document.getElementById('kmlLayerSelect').value;
    if (id) {
        localStorage.setItem('pinnedKmlId', id);
        window.showMessageCustom({ title: '釘選成功', message: '已設為預設', autoClose: true });
    }
};

document.getElementById('kmlLayerSelect').onchange = (e) => window.loadKml(e.target.value);