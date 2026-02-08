import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

onAuthStateChanged(window.auth, async (u) => {
    const dash = document.getElementById('loggedInDashboard');
    const form = document.getElementById('loginForm');
    if (u) {
        const snap = await getDoc(doc(window.db, `apps/${window.appId}/users`, u.uid));
        window.App.userRole = snap.exists() ? snap.data().role : 'guest';
        dash.style.display = 'block';
        form.style.display = 'none';
        document.getElementById('userEmailDisplay').textContent = u.email;
        if (window.App.userRole === 'admin') document.getElementById('registrationSettingsSection').style.display = 'block';
    } else {
        dash.style.display = 'none';
        form.style.display = 'block';
    }
});

window.googleLogin = () => signInWithPopup(window.auth, new GoogleAuthProvider());
window.logout = () => signOut(window.auth);