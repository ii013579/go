import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

setTimeout(() => {
    if (window.updateKmlSelect) {
        console.log("Guest 模式：嘗試預載資料庫...");
        window.updateKmlSelect();
    }
}, 1000);

onAuthStateChanged(window.auth, async (user) => {
    const dash = document.getElementById('loggedInDashboard');
    const form = document.getElementById('loginForm');
    
    if (user) {
        const userRef = doc(window.db, `apps/${window.appId}/users`, user.uid);
        const userSnap = await getDoc(userRef);
        window.App.userRole = userSnap.exists() ? userSnap.data().role : 'guest';
        
        if(dash) dash.style.display = 'block';
        if(form) form.style.display = 'none';
        
        // 登入後再次刷新（以獲取權限圖層）
        if (window.updateKmlSelect) window.updateKmlSelect();
    } else {
        window.App.userRole = 'guest';
        if(dash) dash.style.display = 'none';
        if(form) form.style.display = 'block';
    }
});