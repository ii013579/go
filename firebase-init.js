const firebaseConfig = {
    apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
    authDomain: "kmldata-d22fb.firebaseapp.com",
    projectId: "kmldata-d22fb",
    storageBucket: "kmldata-d22fb.firebasestorage.app",
    messagingSenderId: "6673236901",
    appId: "1:6673236901:web:5aac773cbb512a14b8de4c"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
window.db = firebase.firestore();
window.auth = firebase.auth();
window.appId = "kmldata-d22fb";

window.showMessage = function(title, msg) {
    const overlay = document.getElementById('messageBoxOverlay');
    document.getElementById('messageBoxTitle').textContent = title;
    document.getElementById('messageBoxMessage').textContent = msg;
    overlay.style.display = 'flex';
};

document.getElementById('messageBoxCloseBtn')?.addEventListener('click', () => {
    document.getElementById('messageBoxOverlay').style.display = 'none';
});