// firebase-init.js v1.9.4

// 1. Firebase 配置 (請確保與您的 Firebase Console 一致)
const firebaseConfig = {
    apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
    authDomain: "kmldata-d22fb.firebaseapp.com",
    projectId: "kmldata-d22fb",
    storageBucket: "kmldata-d22fb.firebasestorage.app",
    messagingSenderId: "6673236901",
    appId: "1:6673236901:web:5aac773cbb512a14b8de4c",
    measurementId: "G-TJFH5SXNJX"
};

// 2. 初始化 Firebase (防止重複初始化)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// 3. 核心服務掛載到 window，確保跨檔案 (守門員、搬運工) 都能共用
window.auth = firebase.auth();
window.db = firebase.firestore();
window.storage = firebase.storage();

/**
 * 4. 關鍵全域變數：appId
 * 確保 Firestore 路徑 artifacts/{appId}/public/... 正確
 * 優先讀取環境變數 __app_id，若無則使用配置的 projectId
 */
window.appId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.projectId;
console.log("Firebase Init: 全域 appId 設定為 ->", window.appId);


// --- 5. 全域 UI 彈窗控制系統 ---

/**
 * 顯示通用彈窗
 * @param {string} title 標題
 * @param {string} message 內容
 * @param {function} callback 關閉後執行的函式
 */
window.showMessage = function(title, message, callback) {
    const messageBoxOverlay = document.getElementById('messageBoxOverlay');
    const messageBoxTitle = document.getElementById('messageBoxTitle');
    const messageBoxMessage = document.getElementById('messageBoxMessage');
    const messageBoxCloseBtn = document.getElementById('messageBoxCloseBtn');

    if (!messageBoxOverlay || !messageBoxTitle || !messageBoxMessage) {
        console.warn("找不到彈窗 HTML 元素，改用原生 alert");
        alert(`${title}: ${message}`);
        if (callback) callback();
        return;
    }

    messageBoxTitle.textContent = title;
    messageBoxMessage.textContent = message;
    messageBoxOverlay.classList.add('visible'); // 加入 CSS 的顯示類別

    const closeHandler = () => {
        window.hideMessage();
        messageBoxCloseBtn.removeEventListener('click', closeHandler);
        if (callback) callback();
    };
    messageBoxCloseBtn.addEventListener('click', closeHandler);
};

/**
 * 隱藏彈窗 (配合地圖載入成功後的自動消失功能)
 */
window.hideMessage = function() {
    const messageBoxOverlay = document.getElementById('messageBoxOverlay');
    if (messageBoxOverlay) {
        messageBoxOverlay.classList.remove('visible');
    }
};

/**
 * 註冊碼驗證彈窗 (含 60 秒倒數計時)
 */
window.showRegistrationCodeModal = function(callback) {
    const modalOverlay = document.getElementById('registrationCodeModalOverlay');
    const registrationCodeInput = document.getElementById('registrationCodeInput');
    const nicknameInput = document.getElementById('nicknameInput');
    const confirmBtn = document.getElementById('confirmRegistrationCodeBtn');
    const cancelBtn = document.getElementById('cancelRegistrationCodeBtn');
    const modalMessage = document.getElementById('registrationModalMessage');

    if (!modalOverlay) return;

    // 重置狀態
    registrationCodeInput.value = '';
    nicknameInput.value = '';
    modalMessage.textContent = '請輸入管理員提供的一次性註冊碼。';
    modalMessage.classList.remove('countdown');
    modalOverlay.classList.add('visible');

    let countdown = 60;
    let timerInterval;

    const updateTimer = () => {
        modalMessage.textContent = `請輸入管理員提供的一次性註冊碼。剩餘時間: ${countdown} 秒`;
        modalMessage.classList.add('countdown');
        if (countdown <= 0) {
            clearInterval(timerInterval);
            modalOverlay.classList.remove('visible');
            cleanupListeners();
            callback(null);
        }
        countdown--;
    };

    const cleanupListeners = () => {
        clearInterval(timerInterval);
        confirmBtn.removeEventListener('click', confirmHandler);
        cancelBtn.removeEventListener('click', cancelHandler);
    };

    const confirmHandler = () => {
        const code = registrationCodeInput.value.trim();
        const nickname = nicknameInput.value.trim();
        if (code && nickname) {
            modalOverlay.classList.remove('visible');
            cleanupListeners();
            callback({ code: code, nickname: nickname });
        } else {
            modalMessage.textContent = '請輸入註冊碼和您的暱稱。';
            modalMessage.classList.remove('countdown');
        }
    };

    const cancelHandler = () => {
        modalOverlay.classList.remove('visible');
        cleanupListeners();
        callback(null);
    };

    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();

    confirmBtn.addEventListener('click', confirmHandler);
    cancelBtn.addEventListener('click', cancelHandler);
};