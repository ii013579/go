/**
 * 檔名：auth.js
 * 版本：v2.1.3
 * 權責：身分驗證、權限判定、全域登入/登出介面
 * 功能：[修正 3-1] 登出功能恢復，解決語法錯誤。
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
        console.log("已成功登出");
        location.reload(); 
    } catch (e) {
        console.error("登出出錯", e);
    }
};

onAuthStateChanged(window.auth, async (user) => {
    const dash = document.getElementById('loggedInDashboard');
    const form = document.getElementById('loginForm');
    const adminSec = document.getElementById('registrationSettingsSection');
    
    if (user) {
        // 更新 UI 狀態
        if(dash) dash.style.display = 'block';
        if(form) form.style.display = 'none';
        document.getElementById('userEmailDisplay').textContent = user.email;

        // 讀取角色權限 (對接 v1.9.6)
        try {
            const userDoc = await getDoc(doc(window.db, "users", user.uid));
            window.App.userRole = userDoc.exists() ? userDoc.data().role : 'guest';
        } catch (e) {
            window.App.userRole = 'guest';
        }

        // 權限顯示邏輯
        if (adminSec) adminSec.style.display = (window.App.userRole === 'owner') ? 'block' : 'none';
        if (window.updateKmlSelect) window.updateKmlSelect();
    } else {
        // 未登入狀態
        window.App.userRole = 'guest';
        if(dash) dash.style.display = 'none';
        if(form) form.style.display = 'block';
        if(adminSec) adminSec.style.display = 'none';
    }
});