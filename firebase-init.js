// firebase-init.js v2.0.0
const firebaseConfig = {
    apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
    authDomain: "kmldata-d22fb.firebaseapp.com",
    projectId: "kmldata-d22fb",
    storageBucket: "kmldata-d22fb.firebasestorage.app",
    messagingSenderId: "6673236901",
    appId: "1:6673236901:web:5aac773cbb512a14b8de4c",
    measurementId: "G-TJFH5SXNJX"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

window.db = firebase.firestore();
window.auth = firebase.auth();
window.appId = "kmldata-d22fb";

// 統一訊息彈窗
window.showMessage = function(title, message) {
    const overlay = document.getElementById('messageBoxOverlay');
    if (overlay) {
        document.getElementById('messageBoxTitle').textContent = title;
        document.getElementById('messageBoxMessage').textContent = message;
        overlay.style.display = 'flex';
    } else {
        alert(`${title}: ${message}`);
    }
};

window.showRegistrationModal = function(show = true) {
    const modal = document.getElementById('registrationCodeModalOverlay');
    if (modal) modal.style.display = show ? 'flex' : 'none';
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('messageBoxCloseBtn')?.addEventListener('click', () => {
        document.getElementById('messageBoxOverlay').style.display = 'none';
    });
});