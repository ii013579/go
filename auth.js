/*************************************************
 * auth.js（v1.9.6 相容修正版）
 *************************************************/

window.authState = {
    uid: null,
    email: null,
    role: 'guest',
    loaded: false
};

const auth = window.firebaseAuth;
const db = window.firebaseDB;

auth.onAuthStateChanged(async (user) => {

    if (!user) {
        authState.uid = null;
        authState.email = null;
        authState.role = 'guest';
        authState.loaded = true;

        // === v1.9.6 bridge ===
        window.currentUserRole = 'guest';
        window.currentUserEmail = null;

        document.dispatchEvent(new Event('auth-ready'));
        return;
    }

    if (authState.loaded && authState.uid === user.uid) {
        document.dispatchEvent(new Event('auth-ready'));
        return;
    }

    try {
        const snap = await db.collection('users').doc(user.uid).get();
        const role = snap.exists ? snap.data().role : 'unapproved';

        authState.uid = user.uid;
        authState.email = user.email;
        authState.role = role;
        authState.loaded = true;

        // === v1.9.6 bridge ===
        window.currentUserRole = role;
        window.currentUserEmail = user.email;

        document.dispatchEvent(new Event('auth-ready'));

    } catch (e) {
        console.error('[auth] load user failed', e);

        authState.role = 'guest';
        authState.loaded = true;
        window.currentUserRole = 'guest';

        document.dispatchEvent(new Event('auth-ready'));
    }
});

// ===== 舊 UI 仍會用到的全域函數 =====
window.isOwner = () => authState.role === 'owner';
window.isEditor = () => authState.role === 'editor';
window.isEditorOrOwner = () =>
    authState.role === 'editor' || authState.role === 'owner';

window.canUploadKml = () => isEditorOrOwner();

window.canDeleteKml = (uploadedBy) => {
    if (isOwner()) return true;
    if (isEditor() && uploadedBy === authState.email) return true;
    return false;
};
