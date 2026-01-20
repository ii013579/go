// auth-kml-management.js v2.1
document.addEventListener('DOMContentLoaded', () => {
    const googleBtn = document.getElementById('googleSignInBtn');
    
    if (googleBtn) {
        googleBtn.onclick = () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider).catch(err => window.showMessage("錯誤", err.message));
        };
    }

    auth.onAuthStateChanged(async (user) => {
        const loginForm = document.getElementById('loginForm');
        const dashboard = document.getElementById('loggedInDashboard');
        if (user) {
            if (loginForm) loginForm.style.display = 'none';
            if (dashboard) dashboard.style.display = 'block';
            if (document.getElementById('userEmailDisplay')) {
                document.getElementById('userEmailDisplay').textContent = user.email;
            }
            window.updateKmlLayerSelects();
        } else {
            if (loginForm) loginForm.style.display = 'block';
            if (dashboard) dashboard.style.display = 'none';
        }
    });
});

window.updateKmlLayerSelects = async function() {
    const snap = await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers').get();
    let options = '<option value="">-- 請選擇資料庫 --</option>';
    snap.forEach(doc => options += `<option value="${doc.id}">${doc.data().name}</option>`);
    
    ['kmlLayerSelect', 'kmlLayerSelectDashboard'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = options;
    });
};