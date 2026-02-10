/**
 * 檔名：auth.js
 * 版本：v2.1.0
 * 權責：身分驗證、權限判定、全域登入/登出介面
 */
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const provider = new GoogleAuthProvider();

window.login = () => {
    signInWithPopup(window.auth, provider).catch(e => alert("登入失敗: " + e.message));
};

window.logoutUser = async () => {
    try {
        await signOut(window.auth);
        console.log("已登出");
        location.reload(); 
    } catch (e) {
        console.error("登出出錯", e);
    }
};

onAuthStateChanged(window.auth, (user) => {
    const dash = document.getElementById('loggedInDashboard');
    const form = document.getElementById('loginForm');
    if (user) {
        if(dash) dash.style.display = 'block';
        if(form) form.style.display = 'none';
        document.getElementById('userEmailDisplay').textContent = user.email;
        if(window.updateKmlSelect) window.updateKmlSelect();
    } else {
        if(dash) dash.style.display = 'none';
        if(form) form.style.display = 'block';
    }
            
        // 對接 v1.9.6 管理權限顯示
        const adminSec = document.getElementById('registrationSettingsSection');
        if (adminSec) adminSec.style.display = (window.App.userRole === 'owner') ? 'block' : 'none';
    } else {
        window.App.userRole = 'guest';
        if(dash) dash.style.display = 'none';
        if(form) form.style.display = 'block';
    }
});