import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const provider = new GoogleAuthProvider();

// 立即掛載，解決 Auth module not ready
window.login = () => {
    signInWithPopup(window.auth, provider).catch(e => alert("登入失敗: " + e.message));
};

onAuthStateChanged(window.auth, async (user) => {
    const dash = document.getElementById('loggedInDashboard');
    const form = document.getElementById('loginForm');
    
    // 無論是否登入，都先讀取資料庫 (恢復 Guest 讀取模式)
    if (window.updateKmlSelect) window.updateKmlSelect();

    if (user) {
        const snap = await getDoc(doc(window.db, `apps/${window.appId}/users`, user.uid));
        window.App.userRole = snap.exists() ? snap.data().role : 'guest';
        dash.style.display = 'block';
        form.style.display = 'none';
        document.getElementById('userEmailDisplay').textContent = user.email;
        
        const pinned = localStorage.getItem('pinnedKmlId');
        if (pinned && window.loadKml) window.loadKml(pinned);
    } else {
        dash.style.display = 'none';
        form.style.display = 'block';
        window.App.userRole = 'guest';
    }
});

// 核心修正：將函式暴露給全域，解決「無法登入」問題
window.login = () => {
    signInWithPopup(window.auth, provider)
        .catch(error => {
            console.error("登入失敗:", error);
            alert("登入失敗: " + error.message);
        });
};

window.logout = () => {
    signOut(window.auth);
};