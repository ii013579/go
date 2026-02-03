// auth.js — v2.0 baseline，功能等同 v1.9.6

window.currentUserRole = 'guest';
window.currentUserEmail = null;

window.authReady = false;

auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.currentUserRole = 'guest';
        window.currentUserEmail = null;
        window.authReady = true;
        document.dispatchEvent(new Event('auth-ready'));
        return;
    }

    try {
        const snap = await db.collection('users').doc(user.uid).get();
        const role = snap.exists ? snap.data().role : 'unapproved';

        window.currentUserRole = role;
        window.currentUserEmail = user.email;
        window.authReady = true;

        document.dispatchEvent(new Event('auth-ready'));
    } catch (err) {
        console.error('[auth] failed', err);
        window.currentUserRole = 'guest';
        window.authReady = true;
        document.dispatchEvent(new Event('auth-ready'));
    }
});

// === v1.9.6 helper（UI 會用）===
window.isOwner = () => window.currentUserRole === 'owner';
window.isEditor = () => window.currentUserRole === 'editor';
window.isEditorOrOwner = () =>
    window.currentUserRole === 'editor' || window.currentUserRole === 'owner';
