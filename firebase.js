// firebase.js
// 來源並改寫自 firebase-init.js
// 初始化 Firebase 並啟用 Firestore persistence
(function () {
  'use strict';

  // Firebase config — 若要替換請在部署時更新這裡或改為環境變數
  const firebaseConfig = {
    apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
    authDomain: "kmldata-d22fb.firebaseapp.com",
    projectId: "kmldata-d22fb",
    storageBucket: "kmldata-d22fb.firebasestorage.app",
    messagingSenderId: "6673236901",
    appId: "1:6673236901:web:5aac773cbb512a14b8de4c",
    measurementId: "G-TJFH5SXNJX"
  };

  // 初始化（假設 Firebase v8 CDN 已載入於 index.html）
  if (!window.firebase) {
    console.error('Firebase 尚未載入，請確認 index.html 已載入 Firebase SDK。');
    return;
  }

  window.firebaseApp = firebase.initializeApp(firebaseConfig);
  // 匯出原先專案用到的全域變數（維持相容）
  window.auth = firebase.auth();
  window.db = firebase.firestore();
  window.storage = firebase.storage();

  // 啟用 offline persistence（嘗試）
  if (window.db && typeof window.db.enablePersistence === 'function') {
    window.db.enablePersistence()
      .then(() => {
        console.info('Firestore persistence 已啟用。');
      })
      .catch((err) => {
        console.warn('無法啟用 Firestore persistence:', err && err.code ? err.code : err);
      });
  }
})();