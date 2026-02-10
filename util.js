/**
 * 檔名：util.js
 * 版本：v2.1.0
 * 權責：全域工具函式、通用彈窗組件
 */
window.showMessage = (title, msg) => {
    const overlay = document.getElementById('messageBoxOverlay');
    if (overlay) {
        document.getElementById('messageBoxTitle').textContent = title;
        document.getElementById('messageBoxMessage').textContent = msg;
        overlay.style.display = 'flex';
        overlay.classList.add('visible');
    }
};
window.hideMessage = () => {
    const overlay = document.getElementById('messageBoxOverlay');
    if (overlay) overlay.style.display = 'none';
};