//(核心初始化)
// init.js v2.0
(function() {
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

    // 將實體掛載到 window 以供全域使用
    window.auth = firebase.auth();
    window.db = firebase.firestore();
    window.storage = firebase.storage();

    // 判定 Firestore 存取路徑
    window.appId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.projectId;

    // 啟用 IndexedDB 快取 (減少重複讀取)
    window.db.enablePersistence({ synchronizeTabs: true })
        .then(() => console.log('Firestore persistence 已啟用'))
        .catch((err) => console.warn('Persistence 啟用失敗:', err.code));

    console.log("Firebase 初始化成功. AppId:", window.appId);
})();
