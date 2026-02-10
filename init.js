/**
 * 郎init.js
 * セv2.1.0 (Module Bridge )
 * 舦砫╰参﹍てFirebase 龟ㄒ本更办㏑丁恨瞶
 * 
 * - ﹍て Firebase App/Auth/Firestore
 * - ﹚竡办 App 篈ン
 * - 琈甮盡 appId  Security Rules 隔畖
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
    authDomain: "kmldata-d22fb.firebaseapp.com",
    projectId: "kmldata-d22fb",
    storageBucket: "kmldata-d22fb.firebasestorage.app",
    messagingSenderId: "6673236901",
    appId: "1:6673236901:web:5aac773cbb512a14b8de4c"
};

const app = initializeApp(firebaseConfig);

// 办本更ㄑㄤ獶˙家舱㊣
window.auth = getAuth(app);
window.db = getFirestore(app);
window.appId = "kmldata-d22fb"; // 籔 Security Rules  match /artifacts/{appId} 癸钡

window.App = {
    map: null,
    markers: L.featureGroup(),
    geoJsonLayers: L.featureGroup(),
    allKmlFeatures: [],
    userRole: 'guest'
};
console.log("System Initialized: v2.1.0");