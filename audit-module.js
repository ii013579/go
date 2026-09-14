/**
 * audit-module.js - 清查與修改覆蓋整合完整版 (Full Refactored Version)
 * 包含：權限控管、地圖重繪、CSV匯出、照片上傳、清查表單、獨立新增點位與編輯刪除。
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
    // 5. 清查管理與表單處理模組
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

    // 表單照片預覽處理
    window.handleAddPhotoPreview = function(input, index) {
        if (input.files && input.files[0]) {
            const previewUrl = URL.createObjectURL(input.files[0]);
            const img = document.getElementById(`add-prev-${index}`);
            if (img) { img.src = previewUrl; img.style.display = 'block'; }
            document.getElementById(`add-icon-${index}`)?.style.setProperty('display', 'none');
            const tagText = document.getElementById(`add-tag-text-${index}`);
            if (tagText) tagText.innerText = '已選取';
        }
    };

    // 開啟新增/修改自訂點位表單
    window.openAddPointModal = async function(param1, param2, param3) {
        let kmlId, lat, lng, editData = null, isEditMode = false;
        
        if (typeof param1 === 'object' && param1 !== null) {
            editData = param1; kmlId = editData.kmlId; lat = editData.lat; lng = editData.lng; isEditMode = !!editData.isEditMode;
        } else {
            kmlId = param1; lat = param2; lng = param3;
        }

        const maxPhotos = window.globalAuditConfigs?.[kmlId]?.targetPhotos || 2; 
        const existingPhotos = editData?.photos || [];
        const defaultName = editData?.pointKey || editData?.name || '';
        const defaultRemark = editData?.note || editData?.remark || '';
        const selectEl = document.getElementById('kmlLayerSelect');
        const kmlLayerName = (selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || kmlId).replace(/\.kml$/i, '').trim();

        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const hasPhoto = !!existingPhotos[i];
            photoHtml += `
                <div style="position:relative; margin-bottom:15px; width:80px;">
                    <div style="border:2px dashed #ccc; height:80px; width:80px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:12px; overflow:hidden; cursor:pointer;">
                        <img id="add-prev-${i}" src="${existingPhotos[i] || ''}" style="width:100%; height:100%; object-fit:cover; display:${hasPhoto ? 'block' : 'none'}; position:absolute; top:0; left:0; z-index:1;">
                        <span id="add-icon-${i}" style="font-size:24px; color:#bbb; display:${hasPhoto ? 'none' : 'block'}; z-index:1;">📷</span>
                        <input type="file" id="add-photo-input-${i}" accept="image/*" capture="environment" onchange="window.handleAddPhotoPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;" title="現場拍照">
                    </div>
                    <label for="add-photo-input-${i}" style="position:absolute; left:50%; transform:translateX(-50%); bottom:-10px; z-index:3; background:#555; color:#fff; font-size:11px; padding:2px 8px; border-radius:12px; cursor:pointer; display:flex; align-items:center; gap:4px; box-shadow:0 2px 4px rgba(0,0,0,0.2); white-space:nowrap; border:1px solid #777;">
                        <span>🖼️</span> <span id="add-tag-text-${i}">${hasPhoto ? '已選取' : '圖庫'}</span>
                    </label>
                </div>`;
        }

        const modalHtml = `
            <div style="text-align: left; color: #333; padding: 0 5px;">
                <div style="margin-bottom: 16px;">
                    <label style="display: block; font-weight: bold; margin-bottom: 8px;">點位名稱 <span style="color: #e74c3c;">*必填</span></label>
                    <input type="text" id="add-point-name" value="${defaultName}" class="swal2-input" style="width: 100%; margin:0; box-sizing:border-box;">
                </div>
                <div style="margin-bottom: 16px;">
                    <label style="display: block; font-weight: bold; margin-bottom: 8px;">設備狀態</label>
                    <select disabled class="swal2-input" style="width: 100%; margin:0; background-color: #e9ecef; cursor: not-allowed;"><option selected>新增</option></select>
                </div>
                <div style="margin-bottom: 16px;">
                    <label style="display: block; font-weight: bold; margin-bottom: 8px;">現場照片 (需拍 ${maxPhotos} 張) <span style="color: #e74c3c;">*必填</span></label>
                    <div style="display: flex; gap: 15px; flex-wrap: wrap;">${photoHtml}</div>
                </div>
                <div>
                    <label style="display: block; font-weight: bold; margin-bottom: 8px;">備註事項</label>
                    <textarea id="add-point-remark" class="swal2-textarea" style="width: 100%; height: 80px; margin:0; box-sizing:border-box;">${defaultRemark}</textarea>
                </div>
            </div>`;

        const { value: formValues } = await Swal.fire({
            title: isEditMode ? '✏️ 修改點位清查紀錄' : '➕ 新增點位清查紀錄',
            html: modalHtml,
            showCancelButton: true,
            confirmButtonText: isEditMode ? '確認修改' : '確認新增',
            focusConfirm: false,
            didOpen: () => document.getElementById('btn-standalone-add-point')?.style.setProperty('display', 'none', 'important'),
            willClose: () => syncAuditButtonVisibility(),
            preConfirm: () => {
                const name = document.getElementById('add-point-name').value.trim();
                const photosArray = [];
                for (let i = 0; i < maxPhotos; i++) {
                    const fileInput = document.getElementById(`add-photo-input-${i}`);
                    const img = document.getElementById(`add-prev-${i}`);
                    if (fileInput?.files?.[0]) photosArray.push(fileInput.files[0]);
                    else if (img?.src && !img.src.startsWith('data:') && !img.src.startsWith('blob:') && img.src !== window.location.href) photosArray.push(img.src);
                }
                if (!name) return Swal.showValidationMessage('請填寫點位名稱！');
                if (photosArray.length < maxPhotos) return Swal.showValidationMessage(`請上傳完整 ${maxPhotos} 張現場照片！`);
                
                return { kmlId, kmlLayerName, lat, lng, pointKey: name, status: '新增', remark: document.getElementById('add-point-remark').value.trim(), photos: photosArray, isEditMode, oldPointKey: isEditMode ? defaultName : null };
            }
        });

        if (formValues) {
            await window.submitNewCustomPoint(formValues);
        }
    };

    // 儲存點位紀錄 (新增或更新)
    window.submitNewCustomPoint = async function(formValues) {
        const { kmlId, kmlLayerName, lat, lng, pointKey, status, remark, photos, isEditMode, oldPointKey } = formValues;
        const ns = window.mapNamespace;
        const currentRecords = window.auditLayersState[kmlId] || {};

        if (!isEditMode || (isEditMode && oldPointKey !== pointKey)) {
            const isDuplicate = !!currentRecords[pointKey] || ns?.allKmlFeatures?.some(f => (f.properties?.name || f.properties?.auditPointKey) === pointKey);
            if (isDuplicate) return Swal.fire('名稱重複', `點名「${pointKey}」已存在！`, 'warning');
        }

        Swal.fire({ title: '儲存中...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

        try {
            const photoUrls = await window.uploadPhotosToStorage(photos, kmlId, pointKey, kmlLayerName);
            const appPath = typeof APP_PATH !== 'undefined' ? APP_PATH : 'kmlData';

            if (isEditMode && oldPointKey && oldPointKey !== pointKey) {
                if (window.auditLayersState[kmlId]) delete window.auditLayersState[kmlId][oldPointKey];
                if (ns?.allKmlFeatures) ns.allKmlFeatures = ns.allKmlFeatures.filter(f => f.properties?.auditPointKey !== oldPointKey);
                await firebase.firestore().collection(appPath).doc(kmlId).collection('auditRecords').doc(oldPointKey).delete();
            }

            const structuredData = { pointName: pointKey, status: "已完成", deviceStatus: status, auditStatus: status, note: remark, photos: photoUrls, lat: parseFloat(lat), lng: parseFloat(lng), isCustomPoint: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
            window.auditLayersState[kmlId] = window.auditLayersState[kmlId] || {};
            window.auditLayersState[kmlId][pointKey] = structuredData;

            const newFeature = { type: "Feature", geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] }, properties: { name: pointKey, kmlId, auditPointKey: pointKey, isCustomPoint: true, isAudited: true, deviceStatus: status, auditNote: remark, photos: photoUrls, fillColor: "#FCD770", color: "#ffffff", radius: 8 } };
            
            if (ns?.allKmlFeatures) {
                const existingIdx = ns.allKmlFeatures.findIndex(f => f.properties?.auditPointKey === pointKey);
                if (existingIdx >= 0) ns.allKmlFeatures[existingIdx] = newFeature;
                else ns.allKmlFeatures.push(newFeature);
            }

            await firebase.firestore().collection(appPath).doc(kmlId).collection('auditRecords').doc(pointKey).set(structuredData, { merge: true });
            
            if (typeof forceMapRefresh === 'function') forceMapRefresh();
            Swal.fire({ icon: 'success', title: isEditMode ? '修改成功' : '新增成功', timer: 1200, showConfirmButton: false });
            
        } catch (e) {
            Swal.fire('錯誤', e.message || '儲存失敗', 'error');
        }
    };

    // 開啟編輯既有點位狀態 (含照片更新與刪除自訂點位)
    window.openAuditEditor = async function(isModifyMode = false) {
        if (!checkHasAuditPermission()) return;
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) return;

        const layerProps = activePoint.feature?.properties || activePoint.properties || {};
        const pointKey = layerProps.name || layerProps.auditPointKey || "未知點位"; 
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs?.[kmlId] || {};
        const maxPhotos = config.targetPhotos || 2;
        const historyRecord = isModifyMode ? (window.auditLayersState?.[kmlId]?.[pointKey] || {}) : {};

        const isUserCreatedPoint = !!(layerProps.isCustomPoint || historyRecord.deviceStatus === '新增');
        const currentPhotos = [...(historyRecord.photos || []), ...Array(maxPhotos)].slice(0, maxPhotos);
        const currentStatus = isUserCreatedPoint ? '新增' : (historyRecord.deviceStatus || '');
        const options = (config.statusOptions || JSON.parse(localStorage.getItem('audit_status_options') || '["正常","損壞","遺失"]')).filter(opt => opt !== '新增');

        const statusHtml = isUserCreatedPoint 
            ? `<select id="swal-status" class="swal2-input" disabled style="width:100%; margin:6px 0 16px 0; background:#e9ecef;"><option value="新增" selected>新增</option></select>`
            : `<select id="swal-status" class="swal2-input" style="width:100%; margin:6px 0 16px 0;"><option value="" ${!currentStatus?'selected':''}>-- 選擇狀態 --</option>${options.map(opt => `<option value="${opt}" ${currentStatus===opt?'selected':''}>${opt}</option>`).join('')}</select>`;

        window._tempPreview = function(input, index) {
            if (input.files?.[0]) {
                const reader = new FileReader();
                reader.onload = e => {
                    document.getElementById('audit-prev-'+index).src = e.target.result;
                    document.getElementById('audit-prev-'+index).style.display = 'block';
                    currentPhotos[index] = e.target.result;
                };
                reader.readAsDataURL(input.files[0]);
            }
        };

        const { value: res, isDenied } = await Swal.fire({
            title: `${isModifyMode ? '修改' : '填寫'}紀錄：${escapeHtml(pointKey)}`,
            html: `
                <div style="text-align:left;">
                    <label style="font-size:14px; font-weight:bold;">設備狀態 <span style="color:red;">*必選</span></label>
                    ${statusHtml}
                    <label style="font-size:14px; font-weight:bold;">照片 (需滿 ${maxPhotos} 張)</label>
                    <div style="display:flex; gap:10px; margin:8px 0 16px 0; overflow-x:auto;">
                        ${currentPhotos.map((url, i) => `<div style="flex-shrink:0; width:80px; height:80px; border:1px dashed #ccc; position:relative;"><img id="audit-prev-${i}" src="${url||''}" style="width:100%; height:100%; object-fit:cover; display:${url?'block':'none'};"><input type="file" onchange="window._tempPreview(this, ${i})" style="position:absolute; inset:0; opacity:0; cursor:pointer;"></div>`).join('')}
                    </div>
                    <label style="font-size:14px; font-weight:bold;">備註</label>
                    <textarea id="swal-note" class="swal2-textarea" style="width:100%; height:70px;">${escapeHtml(historyRecord.note||'')}</textarea>
                </div>`,
            showCancelButton: true, showDenyButton: isUserCreatedPoint, denyButtonText: '🗑️ 刪除點位',
            confirmButtonText: '上傳更新',
            didOpen: () => document.getElementById('btn-standalone-add-point')?.style.setProperty('display', 'none', 'important'),
            willClose: () => syncAuditButtonVisibility(),
            preConfirm: () => {
                const status = document.getElementById('swal-status').value;
                if (!status) return Swal.showValidationMessage('請選擇設備狀態');
                if (currentPhotos.filter(p => p).length < maxPhotos) return Swal.showValidationMessage(`請補滿 ${maxPhotos} 張照片`);
                return { status, note: document.getElementById('swal-note').value, photos: currentPhotos };
            }
        });

        if (res) {
            Swal.fire({ title: '上傳中...', didOpen: () => Swal.showLoading() });
            const photoUrls = await window.uploadPhotosToStorage(res.photos, kmlId, pointKey);
            const data = { pointName: pointKey, status: "已完成", deviceStatus: res.status, note: res.note, photos: photoUrls, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
            
            window.auditLayersState[kmlId] = window.auditLayersState[kmlId] || {};
            window.auditLayersState[kmlId][pointKey] = data;
            await firebase.firestore().collection(typeof APP_PATH !== 'undefined' ? APP_PATH : 'kmlData').doc(kmlId).collection('auditRecords').doc(pointKey).set(data, { merge: true });
            
            if (typeof forceMapRefresh === 'function') forceMapRefresh();
            Swal.fire({ icon: 'success', title: '更新成功', timer: 1000, showConfirmButton: false });
            
        } else if (isDenied && isUserCreatedPoint) {
            // 刪除自訂點位邏輯
            const confirmDelete = await Swal.fire({ title: '確定刪除此點位？', text: '刪除後將無法復原！', icon: 'warning', showCancelButton: true, confirmButtonText: '確定刪除', confirmButtonColor: '#d33' });
            if (confirmDelete.isConfirmed) {
                Swal.fire({ title: '刪除中...', didOpen: () => Swal.showLoading() });
                try {
                    await firebase.firestore().collection(typeof APP_PATH !== 'undefined' ? APP_PATH : 'kmlData').doc(kmlId).collection('auditRecords').doc(pointKey).delete();
                    if (window.auditLayersState[kmlId]) delete window.auditLayersState[kmlId][pointKey];
                    if (window.mapNamespace?.allKmlFeatures) {
                        window.mapNamespace.allKmlFeatures = window.mapNamespace.allKmlFeatures.filter(f => f.properties?.auditPointKey !== pointKey);
                    }
                    if (typeof forceMapRefresh === 'function') forceMapRefresh();
                    Swal.fire({ icon: 'success', title: '點位已刪除', timer: 1000, showConfirmButton: false });
                } catch (e) {
                    Swal.fire('錯誤', e.message || '刪除失敗', 'error');
                }
            }
        }
    };

    // ==========================================
    // 6. 獨立新增點位互動
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