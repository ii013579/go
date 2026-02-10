/**
 * data-manager.js - 終極整合版
 * 權責：100% 承接 auth-kml-management.js 功能，並導入快取機制減少 Firebase 讀取。
 */

const DataManager = (function () {
    'use strict';

    // --- 1. 私有狀態與快取 ---
    const _state = {
        user: null,
        userRole: 'unapproved',
        kmlListCache: null,         // 快取 KML 列表
        kmlContentCache: new Map(), // 快取 KML 內容 (ID -> Data)
        unsubscribeAuth: null
    };

    // --- 修正：強制從全域獲取 Firebase 實例 (解決作用域問題) ---
    const _db = window.db || (typeof db !== 'undefined' ? db : firebase.firestore());
    const _auth = window.auth || (typeof auth !== 'undefined' ? auth : firebase.auth());
    const _appId = window.appId || (typeof appId !== 'undefined' ? appId : firebase.app().options.projectId);

    // 輔助函式：快速獲取 DOM
    const $ = id => document.getElementById(id);

    // --- 2. 初始化：監聽 Auth 狀態 ---
    const init = () => {
        _state.unsubscribeAuth = _auth.onAuthStateChanged(async (user) => {
            if (user) {
                _state.user = user;
                await _refreshUserRole(user.uid);
                _updateUIVisibility();
                _loadKmlListToSelects(); // 初始化下拉選單
            } else {
                _state.user = null;
                _state.userRole = 'unapproved';
                _handleLoggedOutUI();
            }
        });

        _bindActionEvents(); // 綁定上傳、刪除、註冊碼按鈕
    };

    // --- 3. 核心功能：角色與權限 ---
    const _refreshUserRole = async (uid) => {
        try {
            const userDoc = await _db.collection('users').doc(uid).get();
            if (userDoc.exists) {
                _state.userRole = userDoc.data().role || 'unapproved';
            }
        } catch (e) {
            console.error("讀取角色失敗:", e);
        }
    };

    const _updateUIVisibility = () => {
        const role = _state.userRole;
        const user = _state.user;

        if ($('loggedInDashboard')) $('loggedInDashboard').style.display = 'block';
        if ($('loginForm')) $('loginForm').style.display = 'none';
        if ($('userEmailDisplay')) $('userEmailDisplay').textContent = `${user.email} (${role})`;

        const isOwner = role === 'owner';
        const isEditor = role === 'editor' || isOwner;

        // 控制面板顯示邏輯
        if ($('uploadKmlSectionDashboard')) $('uploadKmlSectionDashboard').style.display = isEditor ? 'block' : 'none';
        if ($('deleteKmlSectionDashboard')) $('deleteKmlSectionDashboard').style.display = isEditor ? 'block' : 'none';
        if ($('registrationSettingsSection')) $('registrationSettingsSection').style.display = isOwner ? 'block' : 'none';
        if ($('userManagementSection')) $('userManagementSection').style.display = isOwner ? 'block' : 'none';
        
        // 若為 Owner，則加載使用者管理列表
        if (isOwner) _loadUserManagementList();
    };

    const _handleLoggedOutUI = () => {
        if ($('loggedInDashboard')) $('loggedInDashboard').style.display = 'none';
        if ($('loginForm')) $('loginForm').style.display = 'block';
    };

    // --- 4. 100% 轉移：使用者管理功能 ---
    const _loadUserManagementList = async () => {
        const container = $('userListContainer');
        if (!container) return;

        try {
            const snapshot = await _db.collection('users').get();
            container.innerHTML = '';

            snapshot.forEach(doc => {
                const data = doc.data();
                const uid = doc.id;
                if (uid === _state.user.uid) return; // 跳過自己

                const item = document.createElement('div');
                item.className = 'user-management-item';
                item.innerHTML = `
                    <div class="user-info">
                        <strong>${data.name || '未具名'}</strong><br><small>${data.email}</small>
                    </div>
                    <div class="user-actions">
                        <select onchange="window.updateUserRole('${uid}', this.value)">
                            <option value="unapproved" ${data.role === 'unapproved' ? 'selected' : ''}>未審核</option>
                            <option value="user" ${data.role === 'user' ? 'selected' : ''}>普通用戶</option>
                            <option value="editor" ${data.role === 'editor' ? 'selected' : ''}>編輯者</option>
                            <option value="owner" ${data.role === 'owner' ? 'selected' : ''}>管理員</option>
                        </select>
                        <button onclick="window.deleteUser('${uid}')" class="delete-btn">刪除</button>
                    </div>
                `;
                container.appendChild(item);
            });
        } catch (e) {
            console.error("載入使用者列表失敗:", e);
        }
    };

    // --- 5. 100% 轉移：KML 列表與釘選 ---
    const _loadKmlListToSelects = async (force = false) => {
        try {
            if (!_state.kmlListCache || force) {
                const snap = await _db.collection('artifacts').doc(_appId)
                    .collection('public').doc('data').collection('kmlLayers')
                    .orderBy('createdAt', 'desc').get();
                _state.kmlListCache = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            }

            const options = _state.kmlListCache.map(k => `<option value="${k.id}">${k.name}</option>`).join('');
            const s1 = $('kmlLayerSelect');
            const s2 = $('kmlLayerSelectDashboard');

            if (s1) s1.innerHTML = '<option value="">-- 選擇圖層 --</option>' + options;
            if (s2) s2.innerHTML = '<option value="">-- 選擇要刪除的圖層 --</option>' + options;

            // 釘選邏輯：自動載入
            const pinnedId = localStorage.getItem('pinnedKmlId');
            if (pinnedId && !force) {
                if (s1) s1.value = pinnedId;
                window.loadKmlLayerFromFirestore(pinnedId);
            }
        } catch (e) { console.error("KML 列表更新失敗:", e); }
    };

    // --- 6. 100% 轉移：按鈕事件綁定 ---
    const _bindActionEvents = () => {
        // 登入登出
        $('googleSignInBtn')?.addEventListener('click', () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            _auth.signInWithPopup(provider).catch(e => window.showMessage?.('錯誤', e.message));
        });
        $('logoutBtn')?.addEventListener('click', () => _auth.signOut());

        // 釘選按鈕
        $('pinButton')?.addEventListener('click', () => {
            const id = $('kmlLayerSelect')?.value;
            if (!id) return window.showMessage?.('提示', '請先選擇圖層');
            const current = localStorage.getItem('pinnedKmlId');
            if (current === id) {
                localStorage.removeItem('pinnedKmlId');
                window.showMessage?.('取消釘選', '下次將不自動載入');
            } else {
                localStorage.setItem('pinnedKmlId', id);
                window.showMessage?.('釘選成功', '下次將自動載入此圖層');
            }
        });

        // 註冊碼生成
        $('generateRegistrationCodeBtn')?.addEventListener('click', async () => {
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            const expiry = Date.now() + (10 * 60 * 1000); // 10分鐘
            try {
                await _db.collection('settings').doc('registration').set({
                    oneTimeCode: code,
                    oneTimeCodeExpiry: firebase.firestore.Timestamp.fromMillis(expiry)
                });
                if ($('registrationCodeDisplay')) $('registrationCodeDisplay').textContent = code;
                window.showMessage?.('成功', '註冊碼已生成');
            } catch (e) { window.showMessage?.('錯誤', '無法生成註冊碼'); }
        });

        // 刪除 KML
        $('deleteSelectedKmlBtn')?.addEventListener('click', async () => {
            const id = $('kmlLayerSelectDashboard')?.value;
            if (!id || !confirm('確定要刪除此圖層嗎？')) return;
            try {
                await _db.collection('artifacts').doc(_appId).collection('public').doc('data').collection('kmlLayers').doc(id).delete();
                _state.kmlContentCache.delete(id);
                window.showMessage?.('成功', '圖層已刪除');
                _loadKmlListToSelects(true);
            } catch (e) { window.showMessage?.('錯誤', '刪除失敗'); }
        });
    };

    // --- 7. 公開介面與全域掛載 ---
    window.updateUserRole = async (uid, newRole) => {
        try {
            await _db.collection('users').doc(uid).update({ role: newRole });
            window.showMessage?.('成功', '權限已更新');
        } catch (e) { window.showMessage?.('錯誤', e.message); }
    };

    window.deleteUser = async (uid) => {
        if (!confirm('刪除用戶？')) return;
        try {
            await _db.collection('users').doc(uid).delete();
            _loadUserManagementList();
        } catch (e) { window.showMessage?.('錯誤', e.message); }
    };

    window.loadKmlLayerFromFirestore = async (id) => {
        if (!id) return;
        try {
            let data;
            if (_state.kmlContentCache.has(id)) {
                data = _state.kmlContentCache.get(id);
            } else {
                const doc = await _db.collection('artifacts').doc(_appId).collection('public').doc('data').collection('kmlLayers').doc(id).get();
                data = doc.data();
                _state.kmlContentCache.set(id, data);
            }
            if (window.renderGeoJsonToMap) window.renderGeoJsonToMap(data, id);
        } catch (e) { console.error("載入 KML 失敗:", e); }
    };

    return { init };
})();

// 啟動大腦
DataManager.init();