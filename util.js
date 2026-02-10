/**
 * 檔名：util.js
 * 版本：v2.1.0
 * 權責：全域工具函式、通用彈窗組件
 * 功能：
 * - 顯示/隱藏自定義訊息視窗 (messageBox)
 * - 格式化時間或資料內容 (預留)
 */

/**
 * 顯示自定義訊息視窗
 * @param {string} title - 標題
 * @param {string} message - 內容
 */
window.showMessage = (title, message) => {
    const overlay = document.getElementById('messageBoxOverlay');
    const titleEl = document.getElementById('messageBoxTitle');
    const messageEl = document.getElementById('messageBoxMessage');
    const closeBtn = document.getElementById('messageBoxCloseBtn');

    if (overlay && titleEl && messageEl) {
        titleEl.textContent = title;
        messageEl.textContent = message;
        overlay.classList.add('visible');
        overlay.style.display = 'flex'; // 確保顯示

        // 綁定關閉按鈕
        if (closeBtn) {
            closeBtn.onclick = () => {
                overlay.classList.remove('visible');
                overlay.style.display = 'none';
            };
        }
    } else {
        // 若找不到自定義 DOM，退回使用原生 alert
        alert(`${title}: ${message}`);
    }
};

/**
 * 隱藏訊息視窗
 */
window.hideMessage = () => {
    const overlay = document.getElementById('messageBoxOverlay');
    if (overlay) {
        overlay.classList.remove('visible');
        overlay.style.display = 'none';
    }
};

console.log("Util Module Loaded");