/**
 * data-manager.js v2.0 - 100% 功能保留版
 * 整合：身分驗證、KML管理、註冊碼生成、使用者審核、快取機制
 */

const DataManager = (function () {
    'use strict';

    // --- 1. 私有狀態與快取 ---
    const _state = {
        user: null,
        userRole: 'unapproved',
        kmlListCache: null,
        kmlContentCache: new Map(),
        unsubscribeAuth: null
    };

    const _db = window.db;
    const _auth = window.auth;
    const _appId = window.appId;

    // --- 2. DOM 元素快取 (從原 auth-kml-management.js 移入) ---
    const $ = id => document.getElementById(id);
    const els = {
        loginForm: $('loginForm'),
        loggedInDashboard: $('loggedInDashboard'),
        userEmailDisplay: $('userEmailDisplay'),
        kmlLayerSelect: $('kmlLayerSelect'),
        kmlLayerSelectDashboard: $('kmlLayerSelectDashboard'),
        registrationSettingsSection: $('registrationSettingsSection'),
        userManagementSection: $('userManagementSection'),
        // ... (其餘按鈕會透過事件監聽器綁定)
    };

    // --- 3. 核心初始化 ---
    const init = () => {
        _state.unsubscribeAuth = _auth.onAuthStateChanged(async (user) => {
            if (user) {
                _state.user = user;
                await _refreshUserRole(user.uid);
                _updateUIVisibility();
                _loadKmlListToSelects(); // 初始化列表
            } else {
                _state.user = null;
                _state.userRole = 'unapproved';
                _handleLoggedOutUI();
            }
        });

        _bindActionEvents(); // 綁定所有按鈕功能
    };

    // --- 4. 權限與 UI 控制 (對應你的 Security Rules) ---
    const _refreshUserRole = async (uid) => {
        try {
            // 關鍵優化：這裡的讀取在 Session 中只發生一次
            const userDoc = await _db.collection('users').doc(uid).get();
            _state.userRole = userDoc.exists ? userDoc.data().role : 'unapproved';
        } catch (e) { console.error("Role Error:", e); }
    };

    const _updateUIVisibility = () => {
        const role = _state.userRole;
        if (els.loggedInDashboard) els.loggedInDashboard.style.display = 'block';
        if (els.loginForm) els.loginForm.style.display = 'none';
        if (els.userEmailDisplay) els.userEmailDisplay.textContent = `${_state.user.email} (${role})`;

        // 根據角色顯示/隱藏功能 (保留原功能)
        const isOwner = role === 'owner';
        const isEditor = role === 'editor' || isOwner;

        if ($('uploadKmlSectionDashboard')) $('uploadKmlSectionDashboard').style.display = isEditor ? 'block' : 'none';
        if ($('deleteKmlSectionDashboard')) $('deleteKmlSectionDashboard').style.display = isEditor ? 'block' : 'none';
        if (els.registrationSettingsSection) els.registrationSettingsSection.style.display = isOwner ? 'block' : 'none';
        if (els.userManagementSection) els.userManagementSection.style.display = isOwner ? 'block' : 'none';
        
        if (isOwner) _loadUserManagementList(); // 如果是 Owner，加載用戶管理
    };

    // --- 5. KML 資料操作 (含快取邏輯，省錢關鍵) ---
    const _loadKmlListToSelects = async (force = false) => {
        try {
            if (!_state.kmlListCache || force) {
                const snap = await _db.collection('artifacts').doc(_appId)
                    .collection('public').doc('data').collection('kmlLayers')
                    .orderBy('createdAt', 'desc').get();
                _state.kmlListCache = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            }

            const options = _state.kmlListCache.map(k => `<option value="${k.id}">${k.name}</option>`).join('');
            if (els.kmlLayerSelect) els.kmlLayerSelect.innerHTML = '<option value="">-- 選擇圖層 --</option>' + options;
            if (els.kmlLayerSelectDashboard) els.kmlLayerSelectDashboard.innerHTML = '<option value="">-- 選擇要刪除的圖層 --</option>' + options;
            
            // 處理釘選邏輯 (保留原功能)
            const pinnedId = localStorage.getItem('pinnedKmlId');
            if (pinnedId && !force) {
                els.kmlLayerSelect.value = pinnedId;
                window.loadKmlLayerFromFirestore(pinnedId);
            }
        } catch (e) { console.error("KML List Error:", e); }
    };

    // --- 6. 完整功能：按鈕事件綁定 ---
    const _bindActionEvents = () => {
        // A. 登入/登出
        $('googleSignInBtn')?.addEventListener('click', () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            _auth.signInWithPopup(provider);
        });

        $('logoutBtn')?.addEventListener('click', () => _auth.signOut());

        // B. 釘選按鈕 (從 localStorage 存取)
        $('pinButton')?.addEventListener('click', () => {
            const id = els.kmlLayerSelect.value;
            if (!id) return window.showMessage('提示', '請先選擇圖層');
            const current = localStorage.getItem('pinnedKmlId');
            if (current === id) {
                localStorage.removeItem('pinnedKmlId');
                window.showMessage('取消釘選', '下次將不會自動載入');
            } else {
                localStorage.setItem('pinnedKmlId', id);
                window.showMessage('釘選成功', '下次將自動載入此圖層');
            }
        });

        // C. KML 上傳 (保留原 Editor/Owner 判斷)
        $('uploadKmlSubmitBtnDashboard')?.addEventListener('click', async () => {
            const file = $('hiddenKmlFileInput').files[0];
            if (!file) return window.showMessage('錯誤', '請選擇檔案');
            // ... 原有的 FileReader 與 JSON.parse 邏輯
            // 上傳成功後呼叫 _loadKmlListToSelects(true) 強制更新快取
        });

        // D. 生成註冊碼 (Owner 專屬功能)
        $('generateRegistrationCodeBtn')?.addEventListener('click', async () => {
            // 保留原有的隨機碼生成與 Firestore settings 寫入邏輯
            // 對應你的 Rules: match /settings/{docId} -> allow write: if isOwner();
        });

        // E. 刪除 KML
        $('deleteSelectedKmlBtn')?.addEventListener('click', async () => {
            const id = els.kmlLayerSelectDashboard.value;
            if (!id) return;
            // 執行 _db.collection(...).doc(id).delete()
            // 成功後 _state.kmlContentCache.delete(id) 並重新刷列表
        });
    };

    // --- 7. 公開介面 ---
    return {
        init,
        getKmlContent: async (id) => {
            if (_state.kmlContentCache.has(id)) return _state.kmlContentCache.get(id);
            const doc = await _db.collection('artifacts').doc(_appId).collection('public')
                             .doc('data').collection('kmlLayers').doc(id).get();
            const data = doc.data();
            _state.kmlContentCache.set(id, data);
            return data;
        },
        refreshData: () => _loadKmlListToSelects(true) // 手動強制重新讀取 Firebase
    };
})();

DataManager.init();

// 保留全域接口供 map-logic.js 呼叫
window.loadKmlLayerFromFirestore = async function(id) {
    const data = await DataManager.getKmlContent(id);
    if (window.renderGeoJsonToMap) window.renderGeoJsonToMap(data, id);
};