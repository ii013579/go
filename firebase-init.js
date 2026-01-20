// firebase-init.js v2.1
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

const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
const appId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.projectId;

// 全域自定義訊息框
window.showMessage = function(title, message, callback) {
    const overlay = document.getElementById('messageBoxOverlay');
    if (!overlay) { alert(message); return; }
    document.getElementById('messageBoxTitle').textContent = title;
    document.getElementById('messageBoxMessage').textContent = message;
    overlay.classList.add('visible');
    document.getElementById('messageBoxCloseBtn').onclick = () => {
        overlay.classList.remove('visible');
        if (callback) callback();
    };
};

// 註冊碼模態框邏輯
window.showRegistrationCodeModal = function(callback) {
    const modal = document.getElementById('registrationModalOverlay');
    modal.classList.add('visible');
    // ...內部計時與確認邏輯
};