/*************************************************
 * firebase.js
 * Firebase 初始化 + Firestore persistence
 * v1.9.6 相容（不影響既有功能）
 *************************************************/

// ===== 防止重複初始化 =====
if (!firebase.apps.length) {
    firebase.initializeApp({
        apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
        authDomain: "kmldata-d22fb.firebaseapp.com",
        projectId: "kmldata-d22fb",
        storageBucket: "kmldata-d22fb.firebasestorage.app",
        messagingSenderId: "6673236901",
        appId: "1:6673236901:web:5aac773cbb512a14b8de4c",
        measurementId: "G-TJFH5SXNJX"
    });
}

// ===== 全域 Firebase 物件 =====
window.firebaseApp = firebase.app();
window.firebaseAuth = firebase.auth();
window.firebaseDB = firebase.firestore();
window.firebaseStorage = firebase.storage();

// ===== 啟用 Firestore 本地快取（降低讀取次數）=====
firebaseDB.enablePersistence({ synchronizeTabs: true })
    .then(() => {
        console.log('[firebase] Firestore persistence enabled');
    })
    .catch((err) => {
        // 多分頁或瀏覽器不支援時會進來，但不影響功能
        console.warn('[firebase] persistence failed:', err.code);
    });

// ===== 基本設定（可選，但安全）=====
firebaseDB.settings({
    ignoreUndefinedProperties: true
});
