import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
  authDomain: "kmldata-d22fb.firebaseapp.com",
  projectId: "kmldata-d22fb",
  storageBucket: "kmldata-d22fb.firebasestorage.app",
  messagingSenderId: "6673236901",
  appId: "1:6673236901:web:5aac773cbb512a14b8de4c"
};

const app = initializeApp(firebaseConfig);

// 核心修正：將實例掛載到 window，讓其他檔案（包含舊版邏輯）可以讀取
window.auth = getAuth(app);
window.db = getFirestore(app);
window.storage = getStorage(app);
window.appId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.projectId;

window.App = {
    map: null,
    markers: L.featureGroup(),
    geoJsonLayers: L.featureGroup(),
    allKmlFeatures: [],
    userRole: 'guest'
};