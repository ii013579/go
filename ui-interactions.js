// ui-interactions.js v2.1
document.addEventListener('DOMContentLoaded', () => {
    const editBtn = document.getElementById('editButton');
    const authSec = document.getElementById('authSection');
    const ctrlSec = document.getElementById('controls');

    // 1. 編輯按鈕切換邏輯 (修復 display 判斷)
    if (editBtn && authSec && ctrlSec) {
        editBtn.onclick = () => {
            const isHidden = window.getComputedStyle(authSec).display === 'none';
            if (isHidden) {
                authSec.style.display = 'flex';
                ctrlSec.style.display = 'none';
                editBtn.textContent = '關閉';
            } else {
                authSec.style.display = 'none';
                ctrlSec.style.display = 'flex';
                editBtn.textContent = '編輯';
            }
        };
    }

    // 2. 搜尋功能
    const searchBox = document.getElementById('searchBox');
    const searchRes = document.getElementById('searchResults');
    if (searchBox && searchRes) {
        searchBox.oninput = (e) => {
            const val = e.target.value.toLowerCase().trim();
            if (!val) { searchRes.style.display = 'none'; return; }

            const matches = window.allKmlFeatures.filter(f => f.properties.name.toLowerCase().includes(val));
            if (matches.length > 0) {
                searchRes.style.display = 'grid';
                searchRes.innerHTML = matches.map(f => `
                    <div class="result-item" onclick="window.handlePick('${f.properties.name}', ${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]})">
                        ${f.properties.name}
                    </div>
                `).join('');
            }
        };
    }
});

window.handlePick = function(name, lat, lon) {
    const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');
    if (window.activatePoint) {
        window.activatePoint(lat, lon, name, labelId);
        window.map.setView([lat, lon], 18);
    }
    document.getElementById('searchResults').style.display = 'none';
};