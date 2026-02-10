import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const provider = new GoogleAuthProvider();

// 強制全域掛載，解決 TypeError
window.login = () => {
    if (!window.auth) return;
    signInWithPopup(window.auth, provider).catch(e => alert("登入失敗: " + e.message));
};

window.logoutUser = () => signOut(window.auth);

onAuthStateChanged(window.auth, async (user) => {
    const dash = document.getElementById('loggedInDashboard');
    const form = document.getElementById('loginForm');
    
    // 無論是否登入，Guest 模式優先讀取
    if (window.updateKmlSelect) window.updateKmlSelect();

    if (user) {
        // 對接 Rules: match /users/{uid}
        const snap = await getDoc(doc(window.db, "users", user.uid));
        const userData = snap.data();
        window.App.userRole = userData ? userData.role : 'guest'; // owner, editor, or guest
        
        if(dash) dash.style.display = 'block';
        if(form) form.style.display = 'none';
        document.getElementById('userEmailDisplay').textContent = user.email;

        // 檢查 owner 權限顯示設定面板
        const adminSec = document.getElementById('registrationSettingsSection');
        if (adminSec) adminSec.style.display = (window.App.userRole === 'owner') ? 'block' : 'none';
        
        const pinned = localStorage.getItem('pinnedKmlId');
        if (pinned && window.loadKml) window.loadKml(pinned);
    } else {
        window.App.userRole = 'guest';
        if(dash) dash.style.display = 'none';
        if(form) form.style.display = 'block';
    }
});