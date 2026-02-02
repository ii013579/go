// inspection.js
window.isEditMode = false;
const editBtn = document.getElementById('editButton');

editBtn.addEventListener('click', () => {
    const authSection = document.getElementById('authSection');
    const controls = document.getElementById('controls');
    
    if (authSection.style.display === 'flex') { // 關閉編輯
        authSection.style.display = 'none';
        controls.style.display = 'flex';
        editBtn.textContent = '編輯';
        window.isEditMode = false;
    } else { // 開啟編輯
        authSection.style.display = 'flex';
        controls.style.display = 'none';
        editBtn.textContent = '關閉';
        window.isEditMode = true;
    }
});