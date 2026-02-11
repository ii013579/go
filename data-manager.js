/**
 * data-manager.js - v1.9.6 邏輯對齊版
 */
const DataManager = (function () {
    'use strict';
    const _state = { user: null, userRole: 'unapproved', kmlListCache: null, kmlContentCache: new Map() };
    const _db = window.db || (typeof db !== 'undefined' ? db : firebase.firestore());
    const _auth = window.auth || (typeof auth !== 'undefined' ? auth : firebase.auth());
    const _appId = window.appId || (typeof appId !== 'undefined' ? appId : firebase.app().options.projectId);

    const $ = id => document.getElementById(id);

    const init = () => {
        _auth.onAuthStateChanged(async (user) => {
            if (user) {
                _state.user = user;
                const userDoc = await _db.collection('users').doc(user.uid).get();
                _state.userRole = userDoc.exists ? userDoc.data().role : 'unapproved';
                _updateUIVisibility();
                _fetchKmlList(false); // 初始載入（包含釘選判斷）
            } else {
                _handleLoggedOut();
            }
        });
        _bindActionEvents();
    };

    // --- 修正：確保圖層選擇能看到資料庫 ---
    const _fetchKmlList = async (force = false) => {
        try {
            const snap = await _db.collection('artifacts').doc(_appId).collection('public').doc('data').collection('kmlLayers').orderBy('createdAt', 'desc').get();
            _state.kmlListCache = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            const options = '<option value="">-- 選擇圖層 --</option>' + _state.kmlListCache.map(k => `<option value="${k.id}">${k.name}</option>`).join('');
            if ($('kmlLayerSelect')) $('kmlLayerSelect').innerHTML = options;
            if ($('kmlLayerSelectDashboard')) $('kmlLayerSelectDashboard').innerHTML = options;

            // 釘選功能：恢復讀取並自動載入
            const pinnedId = localStorage.getItem('pinnedKmlId');
            if (pinnedId && !force) {
                if ($('kmlLayerSelect')) $('kmlLayerSelect').value = pinnedId;
                window.loadKmlLayerFromFirestore(pinnedId);
            }
        } catch (e) { console.error("資料庫讀取失敗:", e); }
    };

    const _bindActionEvents = () => {
        // 修正：上傳圖層 - 點擊顯示檔名與解析 JSON
        const fileInput = $('hiddenKmlFileInput');
        fileInput?.addEventListener('change', (e) => {
            if (e.target.files[0] && $('selectedKmlFileNameDashboard')) {
                $('selectedKmlFileNameDashboard').textContent = e.target.files[0].name;
            }
        });

        $('uploadKmlSubmitBtnDashboard')?.addEventListener('click', () => {
            const file = fileInput.files[0];
            if (!file) return window.showMessage?.('錯誤', '請選擇檔案');
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const geojson = JSON.parse(e.target.result);
                    await _db.collection('artifacts').doc(_appId).collection('public').doc('data').collection('kmlLayers').add({
                        name: file.name.replace(/\.[^/.]+$/, ""),
                        geojson: JSON.stringify(geojson),
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        uploadedBy: _state.user.email
                    });
                    window.showMessage?.('成功', '圖層上傳完成');
                    _fetchKmlList(true);
                } catch (err) { window.showMessage?.('錯誤', '解析 JSON 失敗'); }
            };
            reader.readAsText(file);
        });

        // 修正：產生註冊碼
        $('generateRegistrationCodeBtn')?.addEventListener('click', async () => {
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            await _db.collection('settings').doc('registration').set({
                oneTimeCode: code,
                oneTimeCodeExpiry: firebase.firestore.Timestamp.fromMillis(Date.now() + 600000)
            });
            if ($('registrationCodeDisplay')) $('registrationCodeDisplay').textContent = code;
        });

        // 修正：圖釘（釘選）操作
        $('pinButton')?.addEventListener('click', () => {
            const id = $('kmlLayerSelect').value;
            if (!id) return;
            const current = localStorage.getItem('pinnedKmlId');
            if (current === id) {
                localStorage.removeItem('pinnedKmlId');
                window.showMessageCustom?.({ title: '取消釘選', message: '已取消自動載入', autoClose: true });
            } else {
                localStorage.setItem('pinnedKmlId', id);
                window.showMessageCustom?.({ title: '釘選成功', message: '下次將自動載入', autoClose: true });
            }
        });

        // 修正：刪除圖層
        $('deleteSelectedKmlBtn')?.addEventListener('click', async () => {
            const id = $('kmlLayerSelectDashboard').value;
            if (!id || !confirm('確定刪除此圖層？')) return;
            await _db.collection('artifacts').doc(_appId).collection('public').doc('data').collection('kmlLayers').doc(id).delete();
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
        $('uploadKmlSectionDashboard').style.display = isEditor ? 'block' : 'none';
        $('deleteKmlSectionDashboard').style.display = isEditor ? 'block' : 'none';
        $('registrationSettingsSection').style.display = isOwner ? 'block' : 'none';
        $('userManagementSection').style.display = isOwner ? 'block' : 'none';
    };

    const _handleLoggedOut = () => { /* 登出處理 */ };

    return { init };
})();
DataManager.init();