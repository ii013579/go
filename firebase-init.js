// firebase-init.js v1.9.4
// 職責：初始化 Firebase 實例與全域 UI 彈窗控制

// 1. Firebase 核心配置 (請確保與您的 Console 一致)
const firebaseConfig = {
    apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
    authDomain: "kmldata-d22fb.firebaseapp.com",
    projectId: "kmldata-d22fb",
    storageBucket: "kmldata-d22fb.firebasestorage.app",
    messagingSenderId: "6673236901",
    appId: "1:6673236901:web:5aac773cbb512a14b8de4c",
    measurementId: "G-TJFH5SXNJX"
};

// 2. 初始化實例 (防止重複初始化)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// 3. 掛載全域實例，供其他 JS 檔案（如 auth-kml-management.js）直接調用
window.db = firebase.firestore();
window.auth = firebase.auth();
window.storage = firebase.storage();
window.appId = "kmldata-d22fb"; // 您的專案路徑識別碼

/**
 * 4. 全域訊息彈窗 (對齊 HTML 中的 messageBoxOverlay 結構)
 * @param {string} title - 標題
 * @param {string} message - 內容
 */
window.showMessage = function(title, message) {
    const overlay = document.getElementById('messageBoxOverlay');
    const titleEl = document.getElementById('messageBoxTitle');
    const msgEl = document.getElementById('messageBoxMessage');

    if (overlay && titleEl && msgEl) {
        titleEl.textContent = title;
        msgEl.textContent = message;
        overlay.style.display = 'flex'; // 顯示遮罩與視窗
    } else {
        // 若 HTML 還沒準備好，退回原生 alert
        alert(`${title}: ${message}`);
    }
};

/**
 * 關閉全域訊息彈窗
 */
window.hideMessage = function() {
    const overlay = document.getElementById('messageBoxOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
};

/**
 * 註冊碼驗證彈窗控制 (對齊 HTML 中的 registrationCodeModalOverlay)
 */
window.showRegistrationModal = function(show = true) {
    const modal = document.getElementById('registrationCodeModalOverlay');
    if (modal) {
        modal.style.display = show ? 'flex' : 'none';
    }
};

// 5. 初始化基礎 UI 事件監聽
document.addEventListener('DOMContentLoaded', () => {
    // 綁定通用訊息框關閉按鈕 (確定按鈕)
    const closeBtn = document.getElementById('messageBoxCloseBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', window.hideMessage);
    }

    // 點擊遮罩外部自動關閉訊息框 (選用功能)
    const msgOverlay = document.getElementById('messageBoxOverlay');
    if (msgOverlay) {
        msgOverlay.addEventListener('click', (e) => {
            if (e.target === msgOverlay) window.hideMessage();
        });
    }
});

console.log("✅ Firebase 地基初始化完成，路徑識別碼:", window.appId);