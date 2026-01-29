// ui-interactions.js v2.0 (¤¶­±¤¬°Ê¼Ò²Õ)
document.addEventListener('DOMContentLoaded', () => {
    const editBtn = document.getElementById('editButton');
    const authSec = document.getElementById('authSection');
    const controls = document.getElementById('controls');
    const searchBox = document.getElementById('searchBox');

    // ¤Á´«½s¿è¼Ò¦¡
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            const isAuth = authSec.style.display === 'flex';
            authSec.style.display = isAuth ? 'none' : 'flex';
            controls.style.display = isAuth ? 'flex' : 'none';
            editBtn.textContent = isAuth ? '½s¿è' : 'Ãö³¬';
        });
    }

    // ·j´MÅÞ¿è
    if (searchBox) {
        searchBox.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            const results = window.DataManager.allFeatures.filter(f => 
                f.properties.name?.toLowerCase().includes(query)
            );
            // ... ´è¬V·j´Mµ²ªG¦CªíÅÞ¿è (¦P v1.9.6)
        });
    }
});