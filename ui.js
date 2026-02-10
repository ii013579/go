document.getElementById('editButton').onclick = () => {
    const auth = document.getElementById('authSection');
    const ctrl = document.getElementById('controls');
    const isEdit = auth.style.display === 'flex';
    auth.style.display = isEdit ? 'none' : 'flex';
    ctrl.style.display = isEdit ? 'flex' : 'none';
    document.getElementById('editButton').textContent = isEdit ? '編輯' : '關閉';
};

document.getElementById('searchBox').oninput = (e) => {
    const val = e.target.value.trim().toLowerCase();
    const res = window.App.allKmlFeatures.filter(f => f.properties.name?.toLowerCase().includes(val));
    const box = document.getElementById('searchResults');
    box.innerHTML = '';
    if (val && res.length) {
        res.slice(0, 10).forEach(f => {
            const div = document.createElement('div');
            div.className = 'search-item';
            div.textContent = f.properties.name;
            div.onclick = () => {
                window.App.map.flyTo([f.geometry.coordinates[1], f.geometry.coordinates[0]], 18);
                box.style.display = 'none';
            };
            box.appendChild(div);
        });
        box.style.display = 'block';
    } else { box.style.display = 'none'; }
};

document.getElementById('kmlLayerSelect').onchange = (e) => window.loadKml(e.target.value);