// auth-kml-management.js v2.0.0
(function() {
    window.auth.onAuthStateChanged(async (user) => {
        const dashboard = document.getElementById('loggedInDashboard');
        const adminSection = document.getElementById('registrationSettingsSection');
        if (user) {
            const userDoc = await window.db.collection('users').doc(user.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                window.currentUserRole = userData.role;
                document.getElementById('userEmailDisplay').textContent = `${user.email} (${userData.role})`;
                document.getElementById('loginForm').style.display = 'none';
                dashboard.style.display = 'block';
                
                if (userData.role === 'owner') {
                    adminSection.style.display = 'block';
                    loadUserList();
                }
                window.updateKmlLayerSelects();
            } else { window.showRegistrationModal(true); }
        } else {
            document.getElementById('loginForm').style.display = 'block';
            dashboard.style.display = 'none';
        }
    });

    async function loadUserList() {
        const snapshot = await window.db.collection('users').get();
        const tbody = document.getElementById('userTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        snapshot.forEach(doc => {
            const u = doc.data();
            tbody.innerHTML += `<tr><td>${u.email}</td><td>${u.name}</td><td>${u.role}</td>
                <td><button onclick="changeRole('${doc.id}','${u.role}')">權限</button></td></tr>`;
        });
    }

    window.changeRole = async (uid, role) => {
        const newRole = role === 'editor' ? 'unapproved' : 'editor';
        await window.db.collection('users').doc(uid).update({ role: newRole });
        loadUserList();
    };

    document.getElementById('googleSignInBtn')?.addEventListener('click', () => {
        window.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    });
    document.getElementById('logoutBtn')?.addEventListener('click', () => window.auth.signOut().then(()=>location.reload()));
})();