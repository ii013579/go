import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const provider = new GoogleAuthProvider();

// 立即掛載到全域，防止 HTML 呼叫不到
window.login = () => {
    if (!window.auth) {
        alert("Firebase 初始化中，請稍候...");
        return;
    }
    signInWithPopup(window.auth, provider).catch(e => alert("登入失敗: " + e.message));
};

window.logoutUser = () => signOut(window.auth);

onAuthStateChanged(window.auth, async (user) => {
    // 即使沒登入，也嘗試讀取資料庫 (解決問題 2-3)
    if (window.updateKmlSelect) window.updateKmlSelect();

    if (user) {
        const snap = await getDoc(doc(window.db, `apps/${window.appId}/users`, user.uid));
        window.App.userRole = snap.exists() ? snap.data().role : 'guest';
        if(dash) dash.style.display = 'block';
        if(form) form.style.display = 'none';
        document.getElementById('userEmailDisplay').textContent = user.email;
        
        const pinned = localStorage.getItem('pinnedKmlId');
        if (pinned && window.loadKml) window.loadKml(pinned);
    } else {
        if(dash) dash.style.display = 'none';
        if(form) form.style.display = 'block';
    }
});