// firebase-init.js

// Firebase 配置
const firebaseConfig = {
  apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
  authDomain: "kmldata-d22fb.firebaseapp.com",
  projectId: "kmldata-d22fb",
  storageBucket: "kmldata-d22fb.firebasestorage.app",
  messagingSenderId: "6673236901",
  appId: "1:6673236901:web:5aac773cbb512a14b8de4c",
  measurementId: "G-TJFH5SXNJX"
};

// 初始化 Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// 統一掛載至全域 window 物件，供其他 JS 檔案存取
window.auth = firebase.auth();
window.db = firebase.firestore();
window.storage = firebase.storage();

// 💡 修正 appId 邏輯：確保 window.appId 被正確賦值
// 優先使用環境變數 __app_id，若無則使用 projectId
window.appId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.projectId;
console.log("Firestore Path App ID:", window.appId);


// --- UI 全域函數 ---

/**
 * 顯示通用彈窗
 */
window.showMessage = function(title, message, callback) {
    const messageBoxOverlay = document.getElementById('messageBoxOverlay');
    const messageBoxTitle = document.getElementById('messageBoxTitle');
    const messageBoxMessage = document.getElementById('messageBoxMessage');
    const messageBoxCloseBtn = document.getElementById('messageBoxCloseBtn');

    if (!messageBoxOverlay || !messageBoxTitle || !messageBoxMessage) {
        alert(`${title}: ${message}`); // 備用方案
        if (callback) callback();
        return;
    }

    messageBoxTitle.textContent = title;
    messageBoxMessage.textContent = message;
    messageBoxOverlay.classList.add('visible');

    const closeHandler = () => {
        window.hideMessage();
        messageBoxCloseBtn.removeEventListener('click', closeHandler);
        if (callback) callback();
    };
    messageBoxCloseBtn.addEventListener('click', closeHandler);
};

/**
 * 💡 新增：隱藏彈窗函數 (供自動關閉功能呼叫)
 */
window.hideMessage = function() {
    const messageBoxOverlay = document.getElementById('messageBoxOverlay');
    if (messageBoxOverlay) {
        messageBoxOverlay.classList.remove('visible');
    }
};

/**
 * 註冊碼輸入模態框 (維持您的計時器功能)
 */
window.showRegistrationCodeModal = function(callback) {
    const modalOverlay = document.getElementById('registrationCodeModalOverlay');
    const registrationCodeInput = document.getElementById('registrationCodeInput');
    const nicknameInput = document.getElementById('nicknameInput');
    const confirmBtn = document.getElementById('confirmRegistrationCodeBtn');
    const cancelBtn = document.getElementById('cancelRegistrationCodeBtn');
    const modalMessage = document.getElementById('registrationModalMessage');

    if (!modalOverlay) return;

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