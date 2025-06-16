// firebase-init.js

// Firebase 配置 (請替換為您自己的 Firebase 專案配置)
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
firebase.initializeApp(firebaseConfig);

// 獲取 Firebase 服務實例
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// 根據 Canvas 環境提供的 __app_id 或是 Firebase 配置中的 projectId 來確定 appId
const appId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.projectId;
console.log("Using App ID for Firestore path:", appId);


// 定義 showMessage 函數以便全局使用
window.showMessage = function(title, message, callback) {
    const messageBoxOverlay = document.getElementById('messageBoxOverlay');
    const messageBoxTitle = document.getElementById('messageBoxTitle');
    const messageBoxMessage = document.getElementById('messageBoxMessage');
    const messageBoxCloseBtn = document.getElementById('messageBoxCloseBtn');

    messageBoxTitle.textContent = title;
    messageBoxMessage.textContent = message;
    messageBoxOverlay.classList.add('visible'); // 顯示彈窗

    const closeHandler = () => {
        messageBoxOverlay.classList.remove('visible'); // 隱藏彈窗
        messageBoxCloseBtn.removeEventListener('click', closeHandler);
        if (callback) {
            callback();
        }
    };
    messageBoxCloseBtn.addEventListener('click', closeHandler);
};

// 定義 showRegistrationCodeModal 函數以便全局使用，增加計時器功能
window.showRegistrationCodeModal = function(callback) {
    const modalOverlay = document.getElementById('registrationCodeModalOverlay');
    const registrationCodeInput = document.getElementById('registrationCodeInput');
    const nicknameInput = document.getElementById('nicknameInput');
    const confirmBtn = document.getElementById('confirmRegistrationCodeBtn');
    const cancelBtn = document.getElementById('cancelRegistrationCodeBtn');
    const modalMessage = document.getElementById('registrationModalMessage');

    registrationCodeInput.value = ''; // 清空註冊碼輸入框
    nicknameInput.value = ''; // 清空暱稱輸入框
    modalMessage.textContent = '請輸入管理員提供的一次性註冊碼。'; // 重設訊息
    modalMessage.classList.remove('countdown'); // 移除計時器樣式
    modalOverlay.classList.add('visible'); // 顯示模態框

    let countdown = 60; // 60秒計時
    let timerInterval;

    const updateTimer = () => {
        modalMessage.textContent = `請輸入管理員提供的一次性註冊碼。剩餘時間: ${countdown} 秒`;
        modalMessage.classList.add('countdown');
        if (countdown <= 0) {
            clearInterval(timerInterval);
            modalOverlay.classList.remove('visible'); // 隱藏模態框
            cleanupListeners();
            callback(null); // 表示時間到，自動取消
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
            modalOverlay.classList.remove('visible'); // 隱藏模態框
            cleanupListeners();
            callback({ code: code, nickname: nickname });
        } else {
            modalMessage.textContent = '請輸入註冊碼和您的暱稱。';
            modalMessage.classList.remove('countdown');
        }
    };

    const cancelHandler = () => {
        modalOverlay.classList.remove('visible'); // 隱藏模態框
        cleanupListeners();
        callback(null); // 表示取消
    };

    // 啟動計時器
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer(); // 立即執行一次以顯示初始時間

    confirmBtn.addEventListener('click', confirmHandler);
    cancelBtn.addEventListener('click', cancelHandler);
};