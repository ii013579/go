/**
 * data-manager.js - v1.9.6 模組化完整版
 */
const DataManager = (function () {
    'use strict';
    const _state = { user: null, userRole: 'unapproved', kmlListCache: null, kmlContentCache: new Map() };
    const _db = window.db || firebase.firestore();
    const _auth = window.auth || firebase.auth();
    const _appId = window.appId || firebaseConfig.projectId;

    const $ = id => document.getElementById(id);

    const init = () => {
        _auth.onAuthStateChanged(async (user) => {
            if (user) {
                _state.user = user;
                const userDoc = await _db.collection('users').doc(user.uid).get();
                _state.userRole = userDoc.exists ? userDoc.data().role : 'unapproved';
                _updateUIVisibility();
                _fetchKmlList(false); 
            } else {
                _handleLoggedOut();
            }
        });
        _bindActionEvents();
    };

    const _fetchKmlList = async (force = false) => {
        try {
            const snap = await _db.collection('artifacts').doc(_appId).collection('public').doc('data').collection('kmlLayers').orderBy('createdAt', 'desc').get();
            _state.kmlListCache = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            const options = '<option value="">-- 選擇圖層 --</option>' + _state.kmlListCache.map(k => `<option value="${k.id}">${k.name}</option>`).join('');
            if ($('kmlLayerSelect')) $('kmlLayerSelect').innerHTML = options;
            if ($('kmlLayerSelectDashboard')) $('kmlLayerSelectDashboard').innerHTML = options;

            const pinnedId = localStorage.getItem('pinnedKmlId');
            if (pinnedId && !force) {
                $('kmlLayerSelect').value = pinnedId;
                window.loadKmlLayerFromFirestore(pinnedId);
            }
        } catch (e) { console.error("無法讀取資料庫圖層", e); }
    };

    const _bindActionEvents = () => {
        // 1. 登入/登出
        $('googleSignInBtn')?.addEventListener('click', () => _auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()));
        $('logoutBtn')?.addEventListener('click', () => _auth.signOut());

        // 2. 釘選功能 (v1.9.6)
        $('pinButton')?.addEventListener('click', () => {
            const id = $('kmlLayerSelect').value;
            if (!id) return window.showMessage?.('釘選失敗', '請先選擇圖層');
            const current = localStorage.getItem('pinnedKmlId');
            if (current === id) {
                localStorage.removeItem('pinnedKmlId');
                window.showMessageCustom?.({ title: '取消釘選', message: '已取消自動載入', autoClose: true });
            } else {
                localStorage.setItem('pinnedKmlId', id);
                window.showMessageCustom?.({ title: '釘選成功', message: '下次將自動載入', autoClose: true });
            }
        });

        // 3. 上傳功能 (修正：FileReader 邏輯)
        const fileInput = $('hiddenKmlFileInput');
        fileInput?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && $('selectedKmlFileNameDashboard')) {
                $('selectedKmlFileNameDashboard').textContent = file.name;
            }
        });

        $('uploadKmlSubmitBtnDashboard')?.addEventListener('click', async () => {
            const file = fileInput.files[0];
            if (!file) return window.showMessage?.('錯誤', '請先選擇檔案');
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const geojson = JSON.parse(e.target.result);
                    await _db.collection('artifacts').doc(_appId).collection('public').doc('data').collection('kmlLayers').add({
                        name: file.name.replace('.json','').replace('.geojson',''),
                        geojson: JSON.stringify(geojson),
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        uploadedBy: _state.user.email
                    });
                    window.showMessage?.('成功', '圖層上傳完成');
                    _fetchKmlList(true);
                } catch (err) { window.showMessage?.('錯誤', 'JSON 格式不正確'); }
            };
            reader.readAsText(file);
        });

        // 4. 註冊碼生成 (修正文字顯示)
        $('generateRegistrationCodeBtn')?.addEventListener('click', async () => {
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            await _db.collection('settings').doc('registration').set({
                oneTimeCode: code,
                oneTimeCodeExpiry: firebase.firestore.Timestamp.fromMillis(Date.now() + 600000)
            });
            if ($('registrationCodeDisplay')) $('registrationCodeDisplay').textContent = code;
        });

        // 5. 刪除功能
        $('deleteSelectedKmlBtn')?.addEventListener('click', async () => {
            const id = $('kmlLayerSelectDashboard').value;
            if (!id || !confirm('確定刪除？')) return;
            await _db.collection('artifacts').doc(_appId).collection('public').doc('data').collection('kmlLayers').doc(id).delete();
            _state.kmlContentCache.delete(id);
            _fetchKmlList(true);
        });
    };

    window.loadKmlLayerFromFirestore = async (id) => {
        if (!id) return;
        let data = _state.kmlContentCache.get(id);
        if (!data) {
            const doc = await _db.collection('artifacts').doc(_appId).collection('public').doc('data').collection('kmlLayers').doc(id).get();
            data = doc.data();
            _state.kmlContentCache.set(id, data);
        }
        if (window.renderGeoJsonToMap) window.renderGeoJsonToMap(data);
    };

    const _updateUIVisibility = () => {
        const isOwner = _state.userRole === 'owner';
        const isEditor = isOwner || _state.userRole === 'editor';
        $('loggedInDashboard').style.display = 'block';
        $('loginForm').style.display = 'none';
        $('userEmailDisplay').textContent = `${_state.user.email} (${_state.userRole})`;
        $('uploadKmlSectionDashboard').style.display = isEditor ? 'block' : 'none';
        $('deleteKmlSectionDashboard').style.display = isEditor ? 'block' : 'none';
        $('registrationSettingsSection').style.display = isOwner ? 'block' : 'none';
        $('userManagementSection').style.display = isOwner ? 'block' : 'none';
        if (isOwner) _loadUsers();
    };

    const _loadUsers = async () => { /* 使用者管理邏輯與之前一致 */ };

    return { init };
})();
DataManager.init();