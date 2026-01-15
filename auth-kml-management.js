// auth-kml-management.js
// 職責：身分驗證、KML 搬運管理 (對齊舊版 ID)

// 1. Firebase 配置
const firebaseConfig = {
    apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
    authDomain: "kmldata-d22fb.firebaseapp.com",
    projectId: "kmldata-d22fb",
    storageBucket: "kmldata-d22fb.firebasestorage.app",
    messagingSenderId: "6673236901",
    appId: "1:6673236901:web:5aac773cbb512a14b8de4c",
    measurementId: "G-TJFH5SXNJX"
};

// 2. 初始化 (如果尚未初始化)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const auth = firebase.auth();
const appId = "kmldata-d22fb"; // 用於規則路徑

// 3. 監聽登入狀態與權限切換
auth.onAuthStateChanged(async (user) => {
    const loginForm = document.getElementById('loginForm');
    const loggedInDashboard = document.getElementById('loggedInDashboard');
    const userEmailDisplay = document.getElementById('userEmailDisplay');
    const adminSection = document.getElementById('registrationSettingsSection');
    const userManagement = document.getElementById('userManagementSection');

    if (user) {
        console.log("登入成功:", user.email);
        if (loginForm) loginForm.style.display = 'none';
        if (loggedInDashboard) loggedInDashboard.style.display = 'block';
        if (userEmailDisplay) userEmailDisplay.textContent = user.email;

        // 檢查角色
        try {
            const userDoc = await db.collection('users').doc(user.uid).get();
            const userData = userDoc.data();
            window.currentUserRole = userData ? userData.role : 'unapproved';

            if (window.currentUserRole === 'owner') {
                if (adminSection) adminSection.style.display = 'block';
                if (userManagement) userManagement.style.display = 'block';
            }
            
            // 更新選單
            await window.updateKmlLayerSelects();
            
            // 圖釘自動載入
            const pinnedId = localStorage.getItem('pinnedKmlId');
            if (pinnedId && window.loadKmlLayerFromFirestore) {
                window.loadKmlLayerFromFirestore(pinnedId);
            }
        } catch (err) {
            console.error("權限讀取失敗:", err);
        }
    } else {
        if (loginForm) loginForm.style.display = 'block';
        if (loggedInDashboard) loggedInDashboard.style.display = 'none';
    }
});

// 4. Google 登入功能 (對應 ID: googleSignInBtn)
document.getElementById('googleSignInBtn')?.addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(err => alert("登入錯誤: " + err.message));
});

// 5. 登出功能 (對應 ID: logoutBtn)
document.getElementById('logoutBtn')?.addEventListener('click', () => {
    auth.signOut().then(() => location.reload());
});

// 6. 整包上傳 KML 邏輯
document.getElementById('uploadKmlSubmitBtnDashboard')?.addEventListener('click', async () => {
    const fileInput = document.getElementById('hiddenKmlFileInput');
    const file = fileInput.files[0];
    if (!file) return alert("請先選擇 KML 檔案");

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            // 需要 toGeoJSON 套件支援
            const kmlDoc = new DOMParser().parseFromString(e.target.result, 'text/xml');
            const geojson = toGeoJSON.kml(kmlDoc);

            // 路徑：artifacts/{appId}/public/data/kmlLayers
            const docRef = db.collection('artifacts').doc(appId)
                .collection('public').doc('data').collection('kmlLayers').doc();

            await docRef.set({
                name: file.name,
                uploadedBy: auth.currentUser.email,
                uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
                geojson: JSON.stringify(geojson)
            });

            alert("整包上傳成功！");
            await window.updateKmlLayerSelects();
        } catch (err) {
            alert("上傳失敗: " + err.message);
        }
    };
    reader.readAsText(file);
});

// 7. 更新選單全域方法 (對應 kmlLayerSelect 與 kmlLayerSelectDashboard)
window.updateKmlLayerSelects = async function() {
    const select = document.getElementById('kmlLayerSelect');
    const dashSelect = document.getElementById('kmlLayerSelectDashboard');
    if (!select) return;

    try {
        const snap = await db.collection('artifacts').doc(appId)
            .collection('public').doc('data').collection('kmlLayers')
            .orderBy('uploadTime', 'desc').get();

        let html = '<option value="">-- 請選擇 KML --</option>';
        snap.forEach(doc => {
            html += `<option value="${doc.id}">${doc.data().name || '未命名'}</option>`;
        });

        select.innerHTML = html;
        if (dashSelect) {
            dashSelect.innerHTML = html;
            dashSelect.disabled = false;
        }
    } catch (err) {
        console.error("選單更新失敗:", err);
    }
};