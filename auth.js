/*************************************************
 * auth.js (v2.0, compatible with v1.9.6)
 * 注意：不宣告 auth / db
 *************************************************/

window.authState = {
    uid: null,
    email: null,
    role: 'guest',
    loaded: false
};

auth.onAuthStateChanged(async (user) => {
    if (!user) {
        authState.uid = null;
        authState.email = null;
        authState.role = 'guest';
        authState.loaded = true;

        // v1.9.6 相容
        window.currentUserRole = 'guest';
        window.currentUserEmail = null;

        document.dispatchEvent(new Event('auth-ready'));
        return;
    }

    // 避免重複讀取
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

        // v1.9.6 相容
        window.currentUserRole = role;
        window.currentUserEmail = user.email;

        document.dispatchEvent(new Event('auth-ready'));

    } catch (err) {
        console.error('[auth] failed to load user doc', err);

        authState.role = 'guest';
        authState.loaded = true;
        window.currentUserRole = 'guest';

        document.dispatchEvent(new Event('auth-ready'));
    }
});

/* ===== v1.9.6 仍會用到的 helper ===== */
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
