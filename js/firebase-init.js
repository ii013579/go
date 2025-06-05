// Firebase 配置 (請替換為您自己的 Firebase 專案配置)
// 從 Firebase Console -> 專案設定 -> 您的應用程式 -> SDK 設定與配置 中獲取
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);

// 獲取 Firebase 服務實例
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// 將 db 和 storage 暴露給其他模組，如果它們在其他模組中需要直接訪問
// 建議使用模組導出/導入，但為保持與舊版本兼容，這裡先直接暴露
// window.db = db;
// window.storage = storage;
// window.auth = auth;

// 定義 showMessage 函數以便全局使用
window.showMessage = function(title, message, callback) {
    const messageBoxOverlay = document.getElementById('messageBoxOverlay');
    const messageBoxTitle = document.getElementById('messageBoxTitle');
    const messageBoxMessage = document.getElementById('messageBoxMessage');
    const messageBoxCloseBtn = document.getElementById('messageBoxCloseBtn');

    messageBoxTitle.textContent = title;
    messageBoxMessage.textContent = message;
    messageBoxOverlay.style.display = 'flex'; // 顯示彈窗

    const closeHandler = () => {
        messageBoxOverlay.style.display = 'none'; // 隱藏彈窗
        messageBoxCloseBtn.removeEventListener('click', closeHandler);
        if (callback) {
            callback();
        }
    };
    messageBoxCloseBtn.addEventListener('click', closeHandler);
};

// 定義 showRegistrationCodeModal 函數以便全局使用
window.showRegistrationCodeModal = function(callback) {
    const modalOverlay = document.getElementById('registrationCodeModalOverlay');
    const registrationCodeInput = document.getElementById('registrationCodeInput');
    const confirmBtn = document.getElementById('confirmRegistrationCodeBtn');
    const cancelBtn = document.getElementById('cancelRegistrationCodeBtn');
    const modalMessage = document.getElementById('registrationModalMessage');

    registrationCodeInput.value = ''; // 清空輸入框
    modalMessage.textContent = ''; // 清空錯誤訊息
    modalOverlay.style.display = 'flex';

    const confirmHandler = () => {
        const code = registrationCodeInput.value.trim();
        if (code) {
            modalOverlay.style.display = 'none';
            confirmBtn.removeEventListener('click', confirmHandler);
            cancelBtn.removeEventListener('click', cancelHandler);
            callback(code);
        } else {
            modalMessage.textContent = '請輸入註冊碼。';
        }
    };

    const cancelHandler = () => {
        modalOverlay.style.display = 'none';
        confirmBtn.removeEventListener('click', confirmHandler);
        cancelBtn.removeEventListener('click', cancelHandler);
        callback(null); // 表示取消
    };

    confirmBtn.addEventListener('click', confirmHandler);
    cancelBtn.addEventListener('click', cancelHandler);
};