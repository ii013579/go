import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const provider = new GoogleAuthProvider();

window.login = () => {
    if (!window.auth) {
        alert("Firebase 尚未就緒，請稍後再試");
        return;
    }
    signInWithPopup(window.auth, provider)
        .then(() => console.log("Login Success"))
        .catch(err => alert("登入失敗: " + err.message));
};

window.logout = () => signOut(window.auth);

// 監聽登入狀態 (與 v1.9.6 邏輯相同)
onAuthStateChanged(window.auth, async (user) => {
    const dash = document.getElementById('loggedInDashboard');
    const form = document.getElementById('loginForm');
    
if (user) {
        console.log("Logged in as:", user.email);
        try {
            const snap = await getDoc(doc(window.db, `apps/${window.appId}/users`, user.uid));
            window.App.userRole = snap.exists() ? snap.data().role : 'guest';
            
            if(dash) dash.style.display = 'block';
            if(form) form.style.display = 'none';
            if(document.getElementById('userEmailDisplay')) {
                document.getElementById('userEmailDisplay').textContent = user.email;
            }
                    
        if (window.App.userRole === 'admin') {
            document.getElementById('registrationSettingsSection').style.display = 'block';
        }
        
        // 觸發 KML 清單更新 )
if (window.updateKmlSelect) window.updateKmlSelect();
            const pinned = localStorage.getItem('pinnedKmlId');
            if (pinned && window.loadKml) window.loadKml(pinned);
            
        } catch (e) { console.error("Auth Snap Error:", e); }
    } else {
        if(dash) dash.style.display = 'none';
        if(form) form.style.display = 'block';
    }
});
        
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