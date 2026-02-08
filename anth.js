import { 
    onAuthStateChanged, 
    signInWithPopup, 
    GoogleAuthProvider, 
    signOut 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const provider = new GoogleAuthProvider();

// 監聽登入狀態 (與 v1.9.6 邏輯相同)
onAuthStateChanged(window.auth, async (user) => {
    const dash = document.getElementById('loggedInDashboard');
    const form = document.getElementById('loginForm');
    
    if (user) {
        // 獲取使用者權限
        const userDoc = await getDoc(doc(window.db, `apps/${window.appId}/users`, user.uid));
        window.App.userRole = userDoc.exists() ? userDoc.data().role : 'guest';
        
        // UI 切換
        dash.style.display = 'block';
        form.style.display = 'none';
        document.getElementById('userEmailDisplay').textContent = user.email;
        
        if (window.App.userRole === 'admin') {
            document.getElementById('registrationSettingsSection').style.display = 'block';
        }
        
        // 觸發 KML 清單更新 (由 data.js 提供)
        if (window.updateSelect) window.updateSelect();
        
        // 檢查釘選
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