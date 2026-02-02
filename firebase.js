// firebase.js
const firebaseConfig = {
    apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
    authDomain: "kmldata-d22fb.firebaseapp.com",
    projectId: "kmldata-d22fb",
    storageBucket: "kmldata-d22fb.firebasestorage.app",
    messagingSenderId: "6673236901",
    appId: "1:6673236901:web:5aac773cbb512a14b8de4c"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// 完整保留 v1.9.6 的自定義訊息框邏輯
window.showMessageCustom = (config) => {
    const overlay = document.getElementById('messageBoxOverlay');
    if (!overlay) return alert(config.message);
    document.getElementById('messageBoxTitle').textContent = config.title;
    document.getElementById('messageBoxMessage').textContent = config.message;
    const btn = document.getElementById('messageBoxBtn');
    btn.textContent = config.buttonText || '確定';
    overlay.classList.add('visible');
    btn.onclick = () => {
        overlay.classList.remove('visible');
        if (config.onClose) config.onClose();
    };
};