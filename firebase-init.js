// firebase-init.js (v2.0, Firebase v9+)

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

/* =========================
   Firebase 設定
========================= */

const firebaseConfig = {
  apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
  authDomain: "kmldata-d22fb.firebaseapp.com",
  projectId: "kmldata-d22fb",
  storageBucket: "kmldata-d22fb.firebasestorage.app",
  messagingSenderId: "6673236901",
  appId: "1:6673236901:web:5aac773cbb512a14b8de4c",
  measurementId: "G-TJFH5SXNJX"
};

/* =========================
   初始化（只會一次）
========================= */

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

/* =========================
   appId（🔥 v1.9.6 行為保留）
========================= */

export const appId =
  typeof window.__app_id !== 'undefined'
    ? window.__app_id
    : firebaseConfig.projectId;

console.log("Using App ID for Firestore path:", appId);

/* =========================
   全域 UI：showMessage（保留）
========================= */

window.showMessage = function (title, message, callback) {
  const overlay = document.getElementById('messageBoxOverlay');
  const titleEl = document.getElementById('messageBoxTitle');
  const msgEl = document.getElementById('messageBoxMessage');
  const closeBtn = document.getElementById('messageBoxCloseBtn');

  titleEl.textContent = title;
  msgEl.textContent = message;
  overlay.classList.add('visible');

  const handler = () => {
    overlay.classList.remove('visible');
    closeBtn.removeEventListener('click', handler);
    if (callback) callback();
  };

  closeBtn.addEventListener('click', handler);
};

/* =========================
   全域 UI：註冊碼 Modal（100% 行為保留）
========================= */

window.showRegistrationCodeModal = function (callback) {
  const overlay = document.getElementById('registrationCodeModalOverlay');
  const codeInput = document.getElementById('registrationCodeInput');
  const nicknameInput = document.getElementById('nicknameInput');
  const confirmBtn = document.getElementById('confirmRegistrationCodeBtn');
  const cancelBtn = document.getElementById('cancelRegistrationCodeBtn');
  const messageEl = document.getElementById('registrationModalMessage');

  codeInput.value = '';
  nicknameInput.value = '';
  overlay.classList.add('visible');

  let countdown = 60;
  let timer;

  const update = () => {
    messageEl.textContent =
      `請輸入管理員提供的一次性註冊碼。剩餘時間: ${countdown} 秒`;
    messageEl.classList.add('countdown');

    if (countdown <= 0) {
      cleanup();
      overlay.classList.remove('visible');
      callback(null);
    }
    countdown--;
  };

  const cleanup = () => {
    clearInterval(timer);
    confirmBtn.removeEventListener('click', onConfirm);
    cancelBtn.removeEventListener('click', onCancel);
  };

  const onConfirm = () => {
    const code = codeInput.value.trim();
    const nickname = nicknameInput.value.trim();
    if (code && nickname) {
      cleanup();
      overlay.classList.remove('visible');
      callback({ code, nickname });
    } else {
      messageEl.textContent = '請輸入註冊碼和您的暱稱。';
      messageEl.classList.remove('countdown');
    }
  };

  const onCancel = () => {
    cleanup();
    overlay.classList.remove('visible');
    callback(null);
  };

  confirmBtn.addEventListener('click', onConfirm);
  cancelBtn.addEventListener('click', onCancel);

  timer = setInterval(update, 1000);
  update();
};
