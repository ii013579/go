/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (Refactored)
 */
(function() {
    'use strict';

    // ==========================================
    // 0. 全域狀態與常數宣告
    // ==========================================
    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = window.globalAuditConfigs || {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;
    let clickDebounceTimer = null;
    let activeAddPointCleanup = null;

    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';
    
    // UI 樣式常數
    const STYLES = {
        btnBase: `color: white; border: none; padding: 8px 20px; border-radius: 25px; font-weight: bold; font-size: 15px; box-shadow: 0 3px 10px rgba(0,0,0,0.3); cursor: pointer; outline: none; line-height: 1.4;`,
        unifiedBtn: `pointer-events: auto; color: #ffffff; border: none; padding: 10px 22px; border-radius: 25px; font-weight: bold; font-size: 15px; box-shadow: 0 3px 10px rgba(0,0,0,0.25); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: transform 0.1s ease, box-shadow 0.1s ease; outline: none;`,
        standaloneBtn: `position: fixed !important; bottom: 20px !important; right: 15px !important; z-index: 4000 !important; color: #ffffff !important; border: none !important; padding: 8px 20px !important; border-radius: 25px !important; font-weight: bold !important; font-size: 15px !important; box-shadow: 0 3px 10px rgba(0,0,0,0.3) !important; cursor: pointer !important; display: none !important; align-items: center !important; justify-content: center !important; gap: 6px !important; outline: none !important; line-height: 1.4 !important; white-space: nowrap !important;`
    };

    // ==========================================
    // 1. 權限防護與安全機制
    // ==========================================
    function getUserRole() {
        return (window.currentUserRole || window.userRole || localStorage.getItem('userRole') || sessionStorage.getItem('userRole') || 'guest').toLowerCase().trim();
    }

    function checkHasAuditPermission() {
        return !['guest', 'unapproved'].includes(getUserRole());
    }

    function canSeeAuditColors() {
        return ['owner', 'editor', 'user'].includes(getUserRole());
    }

    function safeEscape(str) {
        if (str == null) return '';
        if (typeof str === 'number' || typeof str === 'boolean') return String(str);
        if (typeof str !== 'string') {
            try { return JSON.stringify(str); } catch (e) { return ''; }
        }
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
    window.escapeHtml = safeEscape;

    // 同步清查懸浮按鈕狀態
    function syncAuditButtonVisibility() {
        const btn = document.getElementById('btn-standalone-add-point');
        if (!btn) return;
        const kmlId = window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        const isAuditing = !!window.globalAuditConfigs[kmlId]?.isAuditing;
        
        btn.style.setProperty('display', (checkHasAuditPermission() && isAuditing) ? 'inline-flex' : 'none', 'important');
    }
    window.syncAuditButtonVisibility = syncAuditButtonVisibility;

    // ==========================================
    // 2. 樣式攔截器與重繪機制
    // ==========================================
    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const kmlId = window.mapNamespace?.currentKmlLayerId;

        if (kmlId && Array.isArray(features)) {
            const config = window.globalAuditConfigs[kmlId];
            const records = window.auditLayersState[kmlId] || {};
            const isAuditingEnabled = config?.isAuditing && canSeeAuditColors();

            features.forEach(f => {
                f.properties = f.properties || {};
                f.properties.kmlId = kmlId;
                const pointKey = f.properties.name || f.properties.title || f.properties.id || f.id || "未知點位";
                f.properties.auditPointKey = pointKey; 

                if (isAuditingEnabled) {
                    const record = records[pointKey];
                    f.properties.isAudited = !!record;
                    f.properties.auditStatus = record ? (record.deviceStatus || "正常") : null;
                    f.properties.auditNote = record?.note;
                    f.properties.photos = record?.photos || [];
                    f.properties.fillColor = record ? "#FCD770" : "#2A00D2"; 
                    f.properties.color = "#ffffff";
                    f.properties.radius = 8;
                    f.properties.fillOpacity = 0.85;
                } else {
                    f.properties.fillColor = "#e74c3c"; 
                    f.properties.radius = 8;
                    f.properties.isAudited = false;
                    f.properties.fillOpacity = 0.85;
                    delete f.properties.auditStatus;
                }
            });
        }
        if (originalAddLayers) return originalAddLayers.apply(this, arguments);
    };

    window.forceMapRefresh = function() {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId;
        if (!ns?.map || !kmlId) return;

        setTimeout(() => {
            if (typeof ns.map.invalidateSize === 'function') ns.map.invalidateSize({ animate: false });
        }, 100);

        const records = window.auditLayersState[kmlId] || {};
        const showAuditMode = window.globalAuditConfigs[kmlId]?.isAuditing && canSeeAuditColors();

        ns.map.eachLayer(layer => {
            if (layer.feature?.properties) {
                const props = layer.feature.properties;
                const pointKey = props.name || props.title || props.id || "未知點位";
                
                if (showAuditMode) {
                    const record = records[pointKey];
                    props.isAudited = !!record;
                    if (record) {
                        props.auditStatus = record.deviceStatus || "正常";
                        props.photos = record.photos || [];
                        props.auditNote = record.note;
                    }
                    if (typeof layer.setStyle === 'function') {
                        layer.setStyle({
                            fillColor: record ? "#ff85c0" : "#3498db",
                            color: "#ffffff",
                            weight: 2,
                            fillOpacity: 0.9,
                            radius: 10
                        });
                    }
                } else {
                    if (typeof layer.setStyle === 'function') {
                        layer.setStyle({ fillColor: "#e74c3c", color: "#ffffff", weight: 1.5, fillOpacity: 0.85, radius: 8 });
                    }
                }
            }
        });

        if (window.addGeoJsonLayers && ns.allKmlFeatures) {
            window.addGeoJsonLayers(ns.allKmlFeatures);
        }
        syncAuditButtonVisibility();
    };

    // ==========================================
    // 3. 底部控制按鈕面板
    // ==========================================
    function updateBottomBtnState() {
        if (!bottomControl?._container) return;
        const active = window.currentSelectedPoint;
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const isAuditing = window.globalAuditConfigs[kmlId]?.isAuditing;

        if (!checkHasAuditPermission() || !canSeeAuditColors() || !active || !isAuditing) {
            bottomControl._container.style.display = 'none';
            return;
        }

        const pointKey = active.feature?.properties?.name || active.properties?.title || "未知點位";
        const isAudited = (window.auditLayersState[kmlId] || {})[pointKey] !== undefined;
        const safePointKey = escapeHtml(pointKey);
        
        let btnHtml = isAudited 
            ? `<button onclick="window.viewAuditDetailOnly('${safePointKey}')" style="background: #e91e63; ${STYLES.btnBase}">查看</button>
               <button onclick="window.openAuditEditor(true)" style="background: #f39c12; ${STYLES.btnBase}">修改</button>`
            : `<button onclick="window.openAuditEditor(false)" style="background: #2ecc71; ${STYLES.btnBase}">清查點位</button>`;

        bottomControl._container.style.display = 'block';
        bottomControl._container.innerHTML = `<div style="text-align: center; pointer-events: auto; display: flex; gap: 10px; justify-content: center; background: transparent; padding: 0;">${btnHtml}</div>`;
    }

    window.addEventListener('click', () => { 
        clearTimeout(clickDebounceTimer);
        clickDebounceTimer = setTimeout(updateBottomBtnState, 150); 
    });

    // ==========================================
    // 4. CSV 總表生成
    // ==========================================
    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos) {
        const activeKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        const records = window.auditLayersState[activeKmlId] || {};
        const features = window.mapNamespace?.allKmlFeatures || [];

        const getCleanPhotoName = (url) => {
            if (!url) return "";
            try {
                return decodeURIComponent(String(url)).split("?")[0].split("/").pop().replace(/\.[^/.]+$/, "").replace(/"/g, '""');
            } catch (e) {
                return String(url).replace(/"/g, '""');
            }
        };

        const photoCount = parseInt(maxPhotos) || 2;
        let headerArr = ["點名", "經度", "緯度", "設備狀態", ...Array.from({length: photoCount}, (_, i) => `照片${i+1}`), "備註"];
        let csvContent = "\uFEFF" + headerArr.join(",") + "\n";

        const featureMap = new Map();
        features.forEach(f => {
            const key = f.properties?.name || f.properties?.title || f.id;
            if (key) featureMap.set(String(key), f);
        });

        const allPointKeys = new Set([...featureMap.keys(), ...Object.keys(records)]);

        allPointKeys.forEach(pointKey => {
            const record = records[pointKey]; 
            const feature = featureMap.get(pointKey);
            let lng = record?.lng ?? feature?.geometry?.coordinates[0] ?? "";
            let lat = record?.lat ?? feature?.geometry?.coordinates[1] ?? "";

            let rowArr = [`"${pointKey.replace(/"/g, '""')}"`, `"${lng}"`, `"${lat}"`];

            if (record) {
                rowArr.push(`"${String(record.deviceStatus || record.status || '正常').replace(/"/g, '""')}"`);
                for (let i = 0; i < photoCount; i++) rowArr.push(`"${getCleanPhotoName(record.photos?.[i])}"`);
                rowArr.push(`"${String(record.remark || record.note || "").replace(/"/g, '""')}"`);
            } else {
                rowArr.push('""', ...Array(photoCount).fill('""'), '""');
            }
            csvContent += rowArr.join(",") + "\n";
        });

        try {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
            const safeLayerName = kmlLayerName || 'default_layer';
            const storagePath = `${STORAGE_ROOT.replace(/^\/+|\/+$/g, '')}/${safeLayerName}/${safeLayerName}_清查總表.csv`;
            return await firebase.storage().ref().child(storagePath).put(blob, { contentType: 'text/csv' });
        } catch (err) {
            console.error("CSV 上傳失敗：", err);
            if (window.downloadCsvFallback) window.downloadCsvFallback(csvContent, `${kmlLayerName || '清查'}_總表.csv`);
        }
    }

    window.downloadCsvFallback = function(csvData, filename) {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([csvData], { type: 'text/csv;charset=utf-8;' }));
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // ==========================================
    // 5. 清查管理與切換
    // ==========================================
    window.showAuditActionModal = async function() {
        if (!checkHasAuditPermission()) return Swal.fire('權限不足', '您的帳號角色不允許管理清查狀態！', 'warning');
        
        const select = document.getElementById('kmlLayerSelect');
        if (!select || select.options.length <= 1) return;

        let listHtml = '<div style="max-height: 380px; overflow-y: auto; text-align: left;">';
        Array.from(select.options).forEach(opt => {
            if (!opt.value) return;
            const config = window.globalAuditConfigs?.[opt.value] || {};
            const isAuditing = config.isAuditing || false;
            const baseName = escapeHtml(opt.getAttribute('data-basename') || opt.textContent.split(' (')[0]);
            const safeVal = escapeHtml(opt.value);

            listHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid #eee;">
                    <div>
                        <div style="font-weight:bold; font-size:14px;">${baseName}</div>
                        <div style="color: ${isAuditing ? '#e67e22' : '#999'}; font-size:12px;">${isAuditing ? `清查中：需照片 ${config.targetPhotos || 2} 張` : '未開啟清查'}</div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        ${isAuditing ? `<button onclick="window.downloadAuditPhotosZip('${safeVal}')" style="background:#8e44ad; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:12px;">下載照片</button>` : ''}
                        <button onclick="window.toggleAuditStatus('${safeVal}', ${!isAuditing})" style="background:${isAuditing ? '#666' : '#3498db'}; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:12px;">${isAuditing ? '關閉' : '開啟'}</button>
                    </div>
                </div>`;
        });
        
        Swal.fire({ title: '圖層清查管理', html: listHtml + '</div>', showConfirmButton: false, showCloseButton: true });
    };

    window.toggleAuditStatus = async function(kmlId, status) {
        if (!checkHasAuditPermission()) return;
        try {
            Swal.close(); 
            if (status) {
                const defaultStatus = JSON.parse(localStorage.getItem('audit_status_options') || '["正常", "損壞", "遺失"]').join(', ');
                const { value: form } = await Swal.fire({
                    title: '⚙️ 清查模式設定',
                    html: `
                        <div style="text-align:left; font-size:14px;">
                            <label style="font-weight:bold; display:block; margin-bottom:6px;">1. 必填照片張數 (1~12)</label>
                            <input id="swal-input-count" type="number" class="swal2-input" value="2" min="1" max="12" style="width:100%; margin:0 0 16px 0; box-sizing:border-box;">
                            <label style="font-weight:bold; display:block; margin-bottom:6px;">2. 設備狀態選項 (逗號分隔)</label>
                            <textarea id="swal-input-status" class="swal2-textarea" style="width:100%; height:80px; margin:0; box-sizing:border-box;">${defaultStatus}</textarea>
                        </div>
                    `,
                    showCancelButton: true,
                    preConfirm: () => {
                        const count = parseInt(document.getElementById('swal-input-count').value, 10);
                        const options = document.getElementById('swal-input-status').value.trim().split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
                        if (!count || count < 1 || count > 12) return Swal.showValidationMessage('照片張數須介於 1~12 張！');
                        if (!options.length) return Swal.showValidationMessage('請至少輸入一個有效狀態！');
                        return { count, options };
                    }
                });

                if (form) {
                    localStorage.setItem('audit_status_options', JSON.stringify(form.options));
                    Swal.fire({ title: '開啟中...', didOpen: () => Swal.showLoading() });
                    await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: true, targetPhotos: form.count, statusOptions: form.options }, { merge: true });
                    window.globalAuditConfigs[kmlId] = { ...window.globalAuditConfigs[kmlId], isAuditing: true };
                    syncAuditButtonVisibility();
                    Swal.fire({ icon: 'success', title: '開啟成功', timer: 1200, showConfirmButton: false });
                } else {
                    window.showAuditActionModal();
                }
            } else {
                Swal.fire({ title: '關閉中...', didOpen: () => Swal.showLoading() });
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: false }, { merge: true });
                window.globalAuditConfigs[kmlId].isAuditing = false;
                syncAuditButtonVisibility();
                Swal.fire({ icon: 'success', title: '關閉成功', timer: 1000, showConfirmButton: false });
            }
        } catch (error) {
            Swal.fire({ icon: 'error', title: '同步失敗', text: error.message }).then(window.showAuditActionModal);
        }
    };

    // ==========================================
    // 6. 獨立點位與照片功能模組
    // ==========================================
    function setAddButtonActiveState(isActive) {
        const btn = document.getElementById('btn-standalone-add-point');
        if (btn) {
            btn.innerHTML = isActive ? '❌ 取消新增' : '➕ 新增點位';
            btn.style.setProperty('background-color', isActive ? '#e74c3c' : '#2ecc71', 'important');
        }
    }
    
    window.startAddCustomPoint = function(kmlId) {
        if (activeAddPointCleanup) {
            activeAddPointCleanup();
            return Swal.fire({ icon: 'info', title: '已取消新增', timer: 1000, showConfirmButton: false });
        }
        if (!checkHasAuditPermission()) return Swal.fire('權限不足', '不允許新增點位！', 'warning');
        
        const targetKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        if (!targetKmlId) return Swal.fire('提示', '請先選擇目標圖層！', 'info');

        const map = window.mapNamespace?.map;
        if (!map) return;

        map.getContainer().style.cursor = 'crosshair';
        setAddButtonActiveState(true);
        Swal.mixin({ toast: true, position: 'top', showConfirmButton: false, timer: 4000 }).fire({ icon: 'info', title: '📍 請點擊地圖新增位置' });

        const handleMapClick = async (e) => {
            cleanup();
            if (window.openAddPointModal) await window.openAddPointModal(targetKmlId, e.latlng.lat, e.latlng.lng);
            else if (window.openCustomPointModal) await window.openCustomPointModal({ isEditMode: false, kmlId: targetKmlId, lat: e.latlng.lat, lng: e.latlng.lng, status: '新增' });
        };
        
        const cleanup = () => { map.off('click', handleMapClick); map.getContainer().style.cursor = ''; activeAddPointCleanup = null; setAddButtonActiveState(false); };
        activeAddPointCleanup = cleanup;
        map.on('click', handleMapClick);
    };

    (function initStandaloneBtn() {
        let btn = document.getElementById('btn-standalone-add-point');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'btn-standalone-add-point';
            btn.innerHTML = '➕ 新增點位';
            document.body.appendChild(btn);
        }
        btn.setAttribute('style', STYLES.standaloneBtn);
        btn.onclick = e => { e.stopPropagation(); window.startAddCustomPoint(); };
        syncAuditButtonVisibility();
    })();

    document.addEventListener('change', e => { if (e.target?.id === 'kmlLayerSelect') setTimeout(syncAuditButtonVisibility, 100); });

    // ==========================================
    // 7. 工具與其他輔助函式
    // ==========================================
    window.uploadPhotosToStorage = async function(photos, kmlId, pointKey, kmlLayerName) {
        if (!photos?.length) return [];
        const rootPath = STORAGE_ROOT || 'audit_photos';
        const targetLayerName = kmlLayerName || document.getElementById('kmlLayerSelect')?.options[document.getElementById('kmlLayerSelect').selectedIndex]?.getAttribute('data-basename')?.replace(/\.kml$/i, '').trim() || '預設區域';
        const safeKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');

        return Promise.all(photos.map(async (photo, idx) => {
            if (!photo || (typeof photo === 'string' && !photo.startsWith('data:image'))) return photo || '';
            const ref = firebase.storage().ref().child(`${rootPath}/${targetLayerName}/${safeKey}_${String(idx + 1).padStart(2, '0')}.jpg`);
            const blob = (photo instanceof File || photo instanceof Blob) ? photo : await (await fetch(photo)).blob();
            await ref.put(blob);
            return ref.getDownloadURL();
        }));
    };

    window.createUnifiedAuditButton = function(text, bgColor, handler) {
        const btn = document.createElement('button');
        btn.innerHTML = text;
        btn.style.cssText = STYLES.unifiedBtn;
        btn.style.background = bgColor;
        btn.onclick = handler;
        return btn;
    };

    // ==========================================
    // 8. 系統監聽與初始化
    // ==========================================
    const initGlobalConfigListener = () => {
        if (!firebase?.apps?.length) return setTimeout(initGlobalConfigListener, 500);
        firebase.firestore().collection(APP_PATH).onSnapshot(snap => {
            snap.forEach(doc => { 
                window.globalAuditConfigs[doc.id] = doc.data(); 
                if (doc.data().isAuditing) startAuditDataListener(doc.id);
            });
            const select = document.getElementById('kmlLayerSelect');
            if (select) {
                Array.from(select.options).forEach(opt => {
                    if (!opt.value) return;
                    const cfg = window.globalAuditConfigs[opt.value];
                    const baseName = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
                    opt.setAttribute('data-basename', baseName);
                    opt.textContent = cfg?.isAuditing ? `${baseName} (清查中:${cfg.targetPhotos}張)` : baseName;
                });
            }
            window.forceMapRefresh();
        });
    };

    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        auditUnsubscribes[kmlId] = firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snap => {
                const updates = {};
                snap.forEach(doc => updates[doc.id] = doc.data());
                window.auditLayersState[kmlId] = updates;
                window.forceMapRefresh(); 
            });
    }

    let checkAttempts = 0;
    const checkMapInterval = setInterval(() => {
        if (window.mapNamespace?.map && typeof L !== 'undefined') {
            clearInterval(checkMapInterval);
            const map = window.mapNamespace.map;
            map.on('moveend zoomend resize', () => setTimeout(() => map.invalidateSize({ animate: false }), 100));
            map.eachLayer(layer => { if (layer instanceof L.TileLayer) { layer.options.keepBuffer = 4; layer.options.updateWhenIdle = false; } });

            const AuditMenu = L.Control.extend({
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                    this._container.style.cssText = 'display:none; position:fixed; bottom:35px; left:50%; transform:translateX(-50%); z-index:5000; pointer-events:none; background:transparent; padding:0; box-shadow:none; gap:12px;';
                    return this._container;
                }
            });
            bottomControl = new AuditMenu();
            bottomControl.addTo(map);
            initGlobalConfigListener();
        } else if (++checkAttempts >= 30) {
            clearInterval(checkMapInterval);
        }
    }, 500);
})();