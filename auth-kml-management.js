// auth-kml-management.js v2.1
document.addEventListener('DOMContentLoaded', () => {
    const kmlSelect = document.getElementById('kmlLayerSelect');
    const googleBtn = document.getElementById('googleSignInBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    // 下拉選單：免登入也可觸發
    if (kmlSelect) {
        kmlSelect.addEventListener('change', (e) => {
            if (window.loadKmlFromFirestore) window.loadKmlFromFirestore(e.target.value);
        });
    }

    // 登入
    if (googleBtn) {
        googleBtn.onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    }

    // 登出（修復重點）
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            if (confirm("確定要登出管理系統？")) {
                auth.signOut().then(() => {
                    window.showMessage("成功", "已登出管理員模式");
                });
            }
        };
    }

    // 監聽權限與同步選單
    auth.onAuthStateChanged(async (user) => {
        const loginForm = document.getElementById('loginForm');
        const dashboard = document.getElementById('loggedInDashboard');
        
        if (user) {
            if (loginForm) loginForm.style.display = 'none';
            if (dashboard) dashboard.style.display = 'block';
            document.getElementById('userEmailDisplay').textContent = user.email;
        } else {
            if (loginForm) loginForm.style.display = 'block';
            if (dashboard) dashboard.style.display = 'none';
        }
        window.updateAllSelects();
    });
});

window.updateAllSelects = async function() {
    try {
        const snap = await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers').get();
        let options = '<option value="">-- 請選擇資料庫 --</option>';
        snap.forEach(doc => options += `<option value="${doc.id}">${doc.data().name}</option>`);
        
        const s1 = document.getElementById('kmlLayerSelect');
        const s2 = document.getElementById('kmlLayerSelectDashboard');
        if (s1) s1.innerHTML = options;
        if (s2) s2.innerHTML = options;
    } catch (e) { console.error("選單更新失敗", e); }
};