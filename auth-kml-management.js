// auth-kml-management.js v2.1
// 處理 Google 登入與下拉選單同步

document.addEventListener('DOMContentLoaded', () => {
    const kmlLayerSelect = document.getElementById('kmlLayerSelect');
    const googleSignInBtn = document.getElementById('googleSignInBtn');

    // 1. 監聽首頁下拉選單變動
    if (kmlLayerSelect) {
        kmlLayerSelect.addEventListener('change', (e) => {
            if (window.loadKmlLayerFromFirestore) {
                window.loadKmlLayerFromFirestore(e.target.value);
            }
        });
    }

    // 2. Google 登入功能 (彈出式)
    if (googleSignInBtn) {
        googleSignInBtn.onclick = () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider).catch(err => console.error("登入錯誤:", err));
        };
    }

    // 3. 登入狀態監聽
    auth.onAuthStateChanged(async (user) => {
        const loginForm = document.getElementById('loginForm');
        const dashboard = document.getElementById('loggedInDashboard');
        const userEmailDisplay = document.getElementById('userEmailDisplay');

        if (user) {
            if (loginForm) loginForm.style.display = 'none';
            if (dashboard) dashboard.style.display = 'block';
            if (userEmailDisplay) userEmailDisplay.textContent = user.email;
            
            // 登入後自動更新下拉選單
            window.syncKmlSelectOptions();
        } else {
            if (loginForm) loginForm.style.display = 'block';
            if (dashboard) dashboard.style.display = 'none';
        }
    });
});

/**
 * 從 Firestore 抓取現有 KML 列表並填入選單
 */
window.syncKmlSelectOptions = async function() {
    try {
        const snap = await db.collection('artifacts').doc(appId)
                             .collection('public').doc('data')
                             .collection('kmlLayers').get();
        
        let html = '<option value="">-- 請選擇資料庫 --</option>';
        snap.forEach(doc => {
            html += `<option value="${doc.id}">${doc.data().name || '未命名'}</option>`;
        });

        const s1 = document.getElementById('kmlLayerSelect');
        const s2 = document.getElementById('kmlLayerSelectDashboard');
        if (s1) s1.innerHTML = html;
        if (s2) s2.innerHTML = html;
    } catch (e) {
        console.error("選單同步失敗:", e);
    }
};