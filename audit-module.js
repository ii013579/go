/**
 * audit-module.js - CSS 抽離與 CU (Create/Update) 邏輯整合優化版
 */
(function() {
    'use strict';

    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;
    let clickDebounceTimer = null;

    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    // ---------------------------------------------------------
    // 0. 基礎安全與權限工具
    // ---------------------------------------------------------
    function getUserRole() {
        return window.currentUserRole || window.userRole || localStorage.getItem('userRole') || sessionStorage.getItem('userRole') || 'guest';
    }

    function checkHasAuditPermission() {
        const role = getUserRole().toLowerCase().trim();
        return role !== 'guest' && role !== 'unapproved';
    }

    function canSeeAuditColors() {
        const role = getUserRole().toLowerCase().trim();
        return ['owner', 'editor', 'user'].includes(role);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ---------------------------------------------------------
    // 1. 地圖渲染與圖層重繪
    // ---------------------------------------------------------
    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId;

        if (kmlId && Array.isArray(features)) {
            const config = window.globalAuditConfigs[kmlId];
            const records = window.auditLayersState[kmlId] || {};

            features.forEach(f => {
                if (!f.properties) f.properties = {};
                f.properties.kmlId = kmlId;
                const pointKey = f.properties.name || f.properties.title || f.properties.id || f.id || "未知點位";
                f.properties.auditPointKey = pointKey; 

                if (config && config.isAuditing === true && canSeeAuditColors()) {
                    const record = records[pointKey];
                    if (record) {
                        f.properties.auditStatus = record.deviceStatus || "正常";
                        f.properties.auditNote = record.note;
                        f.properties.photos = record.photos || [];
                        f.properties.isAudited = true;
                        f.properties.fillColor = "#FCD770";
                    } else {
                        f.properties.isAudited = false;
                        f.properties.auditStatus = null;
                        f.properties.fillColor = "#2A00D2";
                    }
                    f.properties.radius = 8;
                    f.properties.color = "#ffffff";
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

    function forceMapRefresh() {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId;
        if (!ns?.map || !kmlId) return;

        const records = window.auditLayersState[kmlId] || {};
        const showAuditMode = window.globalAuditConfigs[kmlId]?.isAuditing && canSeeAuditColors();

        ns.map.eachLayer(function(layer) {
            if (layer.feature && layer.feature.properties) {
                const props = layer.feature.properties;
                const pointKey = props.name || props.title || props.id || "未知點位";
                
                if (showAuditMode) {
                    const record = records[pointKey];
                    if (record) {
                        props.isAudited = true;
                        props.auditStatus = record.deviceStatus || "正常";
                        props.photos = record.photos || [];
                        props.auditNote = record.note;
                        if (typeof layer.setStyle === 'function') {
                            layer.setStyle({ fillColor: "#ff85c0", color: "#ffffff", weight: 2, fillOpacity: 0.9, radius: 10 });
                        }
                    } else {
                        props.isAudited = false;
                        if (typeof layer.setStyle === 'function') {
                            layer.setStyle({ fillColor: "#3498db", color: "#ffffff", weight: 2, fillOpacity: 0.9, radius: 10 });
                        }
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
    }

    // ---------------------------------------------------------
    // 2. 統一的 CU (Create / Update) Modal 與資料處理模組
    // ---------------------------------------------------------

    // 處理照片預覽 (Base64 壓縮)
    window._tempAuditPhotoPreview = function(input, index) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width, height = img.height;
                    const max_size = 1920;
                    if (width > height) { if (width > max_size) { height *= max_size / width; width = max_size; } } 
                    else { if (height > max_size) { width *= max_size / height; height = max_size; } }
                    canvas.width = width; canvas.height = height;
                    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                    const base64 = canvas.toDataURL('image/jpeg', 0.82);
                    
                    const prevEl = document.getElementById(`audit-prev-${index}`);
                    const iconEl = document.getElementById(`audit-icon-${index}`);
                    const tagEl = document.getElementById(`audit-tag-${index}`);

                    if (prevEl) { prevEl.src = base64; prevEl.style.display = 'block'; }
                    if (iconEl) iconEl.style.display = 'none';
                    if (tagEl) tagEl.innerHTML = '<span>🖼️</span> 新選擇';

                    window._currentAuditCUPhotos[index] = base64;
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(input.files[0]);
        }
    };

    /**
     * 核心整合：開啟 Create / Update 統一視窗
     * @param {Object} options 包含 isEdit, kmlId, pointKey, lat, lng, photos, deviceStatus, note 等
     */
    window.openAuditCUModal = async function(options = {}) {
        if (!checkHasAuditPermission()) {
            Swal.fire('權限不足', '您的帳號角色不允許編輯清查資料！', 'warning');
            return;
        }

        const {
            isEditMode = false,
            kmlId = window.mapNamespace?.currentKmlLayerId,
            oldPointKey = '',
            pointKey = '',
            lat = 0,
            lng = 0,
            deviceStatus = '',
            note = '',
            photos = []
        } = options;

        const config = window.globalAuditConfigs[kmlId] || {};
        const maxPhotos = config.targetPhotos || 2;
        const selectEl = document.getElementById('kmlLayerSelect');
        const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '預設區域';
        const kmlLayerName = rawLayerName.replace(/\.kml$/i, '').trim();

        window._currentAuditCUPhotos = new Array(maxPhotos).fill('');
        if (Array.isArray(photos)) {
            photos.forEach((p, idx) => {
                if (idx < maxPhotos) window._currentAuditCUPhotos[idx] = p || '';
            });
        }

        let statusOptions = config.statusOptions || 
            (localStorage.getItem('audit_status_options') ? JSON.parse(localStorage.getItem('audit_status_options')) : ['正常','損壞','遺失']);

        if (!statusOptions.includes('新增')) statusOptions = ['新增', ...statusOptions];

        const isNewCustomPoint = !isEditMode || deviceStatus === '新增';

        let statusSelectHtml = '';
        if (isNewCustomPoint) {
            statusSelectHtml = `
                <select id="audit-input-status" class="audit-select" disabled>
                    <option value="新增" selected>新增</option>
                </select>`;
        } else {
            const optionsHtml = statusOptions.map(opt => 
                `<option value="${opt}" ${deviceStatus === opt ? 'selected' : ''}>${opt}</option>`
            ).join('');
            statusSelectHtml = `
                <select id="audit-input-status" class="audit-select">
                    <option value="" ${!deviceStatus ? 'selected' : ''}>--- 請選擇設備狀態 ---</option>
                    ${optionsHtml}
                </select>`;
        }

        let photoGridHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const photoData = window._currentAuditCUPhotos[i] || '';
            const isUrl = photoData.startsWith('http');
            photoGridHtml += `
                <div class="audit-photo-card">
                    <div class="audit-photo-box">
                        <img id="audit-prev-${i}" class="audit-photo-preview" src="${photoData}" style="display:${photoData ? 'block' : 'none'};">
                        <span id="audit-icon-${i}" class="audit-photo-icon" style="display:${photoData ? 'none' : 'block'};">📷</span>
                        <input type="file" id="audit-photo-input-${i}" class="audit-photo-input" accept="image/*" capture="environment" onchange="window._tempAuditPhotoPreview(this, ${i})" title="拍攝/選擇照片">
                    </div>
                    <div id="audit-tag-${i}" class="audit-photo-tag">
                        ${isUrl ? '<span>🖼️</span> 舊照片' : (photoData ? '<span>🖼️</span> 新選擇' : '<span>📷</span> 上傳')}
                    </div>
                </div>`;
        }

        const modalHtml = `
            <div class="audit-modal-body">
                <div class="audit-modal-header">
                    <span style="color: ${isEditMode ? '#f39c12' : '#2ecc71'}; font-size: 22px;">${isEditMode ? '✏️' : '➕'}</span>
                    <span>${isEditMode ? '修改清查紀錄' : '新增點位清查'}</span>
                </div>

                <div class="audit-form-group">
                    <label class="audit-form-label">點位名稱 / 點名 <span class="required">*必填</span></label>
                    <input type="text" id="audit-input-name" class="audit-input" value="${escapeHtml(pointKey)}" placeholder="例如：新設電桿-01" ${isEditMode && !isNewCustomPoint ? 'readonly' : ''}>
                </div>

                <div class="audit-form-group">
                    <label class="audit-form-label">設備狀態 <span class="required">*必選</span></label>
                    ${statusSelectHtml}
                </div>

                <div class="audit-form-group">
                    <label class="audit-form-label">現場照片 (需滿 ${maxPhotos} 張) <span class="required">*必填</span></label>
                    <div class="audit-photo-grid">${photoGridHtml}</div>
                </div>

                <div class="audit-form-group" style="margin-bottom:0;">
                    <label class="audit-form-label">備註事項 <span class="optional">(選填)</span></label>
                    <textarea id="audit-input-remark" class="audit-textarea" placeholder="輸入備註事項...">${escapeHtml(note)}</textarea>
                </div>
            </div>`;

        const { value: formValues, isDenied } = await Swal.fire({
            html: modalHtml,
            showCancelButton: true,
            showDenyButton: isEditMode && isNewCustomPoint,
            denyButtonText: '🗑️ 刪除點位',
            denyButtonColor: '#e74c3c',
            confirmButtonText: isEditMode ? '覆蓋更新' : '確認上傳',
            cancelButtonText: '取消',
            confirmButtonColor: '#2ecc71',
            cancelButtonColor: '#707a86',
            focusConfirm: false,
            preConfirm: () => {
                const inputName = document.getElementById('audit-input-name').value.trim();
                const inputStatus = document.getElementById('audit-input-status').value;
                const inputRemark = document.getElementById('audit-input-remark').value.trim();

                if (!inputName) { Swal.showValidationMessage('請填寫點位名稱！'); return false; }
                if (!inputStatus) { Swal.showValidationMessage('請選擇設備狀態！'); return false; }

                const validPhotos = window._currentAuditCUPhotos.filter(p => p && p.trim() !== '');
                if (validPhotos.length < maxPhotos) {
                    Swal.showValidationMessage(`請上傳完整 ${maxPhotos} 張照片 (目前 ${validPhotos.length}/${maxPhotos})`);
                    return false;
                }

                return {
                    kmlId, kmlLayerName, isEditMode, oldPointKey,
                    pointKey: inputName,
                    status: inputStatus,
                    remark: inputRemark,
                    lat: parseFloat(lat),
                    lng: parseFloat(lng),
                    photos: window._currentAuditCUPhotos
                };
            }
        });

        delete window._currentAuditCUPhotos;

        if (isDenied && isEditMode) {
            window.deleteCustomPoint(kmlId, oldPointKey || pointKey, kmlLayerName);
            return;
        }

        if (formValues) {
            await window.submitAuditCUData(formValues);
        }
    };

    /**
     * 核心整合：提交 CU (Create / Update) 資料至 Firestore 與 Storage
     */
    window.submitAuditCUData = async function(formValues) {
        const { kmlId, kmlLayerName, isEditMode, oldPointKey, pointKey, status, remark, lat, lng, photos } = formValues;

        // 檢查名稱重複 (針對 Create 或修改點名時)
        const ns = window.mapNamespace;
        const currentRecords = window.auditLayersState[kmlId] || {};

        if (!isEditMode || (isEditMode && oldPointKey !== pointKey)) {
            let isDuplicateInKml = ns?.allKmlFeatures?.some(f => {
                const name = f.properties?.name || f.properties?.title || f.properties?.auditPointKey;
                return name === pointKey;
            });
            if (isDuplicateInKml || !!currentRecords[pointKey]) {
                Swal.fire({
                    icon: 'warning',
                    title: '點位名稱重複',
                    text: `點名「${pointKey}」已存在！請修改名稱後再送出。`,
                    confirmButtonText: '確定'
                });
                return;
            }
        }

        Swal.fire({ title: '正在儲存資料...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        try {
            // 照片批次上傳至 Firebase Storage
            const photoUrls = await window.uploadPhotosToStorage(photos, kmlId, pointKey, kmlLayerName);

            // 若為修改且更換點名，刪除舊點位 Firestore 紀錄
            if (isEditMode && oldPointKey && oldPointKey !== pointKey) {
                delete window.auditLayersState[kmlId][oldPointKey];
                if (ns?.allKmlFeatures) {
                    ns.allKmlFeatures = ns.allKmlFeatures.filter(f => (f.properties?.name || f.properties?.title || f.properties?.auditPointKey) !== oldPointKey);
                }
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(oldPointKey).delete();
            }

            const structuredData = {
                pointName: pointKey,
                status: "已完成",
                deviceStatus: status,
                note: remark || "",
                photos: photoUrls,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
                structuredData.lat = lat;
                structuredData.lng = lng;
                structuredData.isCustomPoint = true;
            }

            if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
            window.auditLayersState[kmlId][pointKey] = structuredData;

            // 更新 Firestore
            await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pointKey).set(structuredData, { merge: true });

            // 更新記憶體 Feature
            if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
                const newGeoJsonFeature = {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [lng, lat] },
                    properties: {
                        name: pointKey, title: pointKey, kmlId, auditPointKey: pointKey,
                        isCustomPoint: true, isAudited: true, auditStatus: status,
                        auditNote: remark, photos: photoUrls, fillColor: "#FCD770", color: "#ffffff", radius: 8, fillOpacity: 0.85
                    }
                };
                if (ns) {
                    if (!Array.isArray(ns.allKmlFeatures)) ns.allKmlFeatures = [];
                    const existingIdx = ns.allKmlFeatures.findIndex(f => (f.properties?.name || f.properties?.title || f.properties?.auditPointKey) === pointKey);
                    if (existingIdx >= 0) ns.allKmlFeatures[existingIdx] = newGeoJsonFeature;
                    else ns.allKmlFeatures.push(newGeoJsonFeature);
                }
            }

            // 重新生成 CSV 總表
            if (typeof generateLayerCsvReport === 'function') {
                await generateLayerCsvReport(kmlId, kmlLayerName, photoUrls.length || 2);
            }

            Swal.fire({ icon: 'success', title: isEditMode ? '修改成功' : '新增成功', timer: 1200, showConfirmButton: false });

            forceMapRefresh();
            setTimeout(updateBottomBtnState, 300);

        } catch (e) {
            console.error("❌ CU 儲存失敗:", e);
            Swal.fire('錯誤', e.message || '儲存失敗', 'error');
        }
    };

    // 對外入口相容包裝
    window.openAuditEditor = function(isModifyMode = false) {
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) return;
        const layerProps = activePoint.feature?.properties || activePoint.properties || {};
        const pointKey = layerProps.name || layerProps.title || layerProps.id || "未知點位"; 
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId;
        const historyRecord = isModifyMode ? (window.auditLayersState?.[kmlId]?.[pointKey] || {}) : {};

        window.openAuditCUModal({
            isEditMode: isModifyMode,
            kmlId: kmlId,
            oldPointKey: pointKey,
            pointKey: pointKey,
            deviceStatus: historyRecord.deviceStatus || layerProps.auditStatus || '',
            note: historyRecord.note || layerProps.auditNote || '',
            photos: historyRecord.photos || layerProps.photos || []
        });
    };

    window.startAddCustomPoint = function(kmlId) {
        if (!checkHasAuditPermission()) { Swal.fire('權限不足', '您的帳號角色不允許新增點位！', 'warning'); return; }
        const targetKmlId = kmlId || window.mapNamespace?.currentKmlLayerId;
        const map = window.mapNamespace?.map;
        if (!map || !targetKmlId) return;

        map.getContainer().style.cursor = 'crosshair';
        Swal.mixin({ toast: true, position: 'top', showConfirmButton: false, timer: 3000 }).fire({ icon: 'info', title: '📍 請在地圖上點擊新增位置' });

        const handleMapClick = async function(e) {
            map.off('click', handleMapClick);
            map.getContainer().style.cursor = '';
            window.openAuditCUModal({
                isEditMode: false,
                kmlId: targetKmlId,
                lat: e.latlng.lat,
                lng: e.latlng.lng,
                deviceStatus: '新增'
            });
        };
        map.once('click', handleMapClick);
    };

    // ---------------------------------------------------------
    // 3. UI 選單與動態按鈕渲染
    // ---------------------------------------------------------
    function updateBottomBtnState() {
        if (!bottomControl || !bottomControl._container) return;
        if (!checkHasAuditPermission() || !canSeeAuditColors()) {
            bottomControl._container.style.display = 'none';
            return;
        }

        const active = window.currentSelectedPoint;
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId];

        if (active && config && config.isAuditing === true) {
            const layerProps = active.feature?.properties || active.properties || {};
            const pointKey = layerProps.name || layerProps.title || layerProps.id || "未知點位";
            const safePointKey = escapeHtml(pointKey);
            const isAudited = !!(window.auditLayersState[kmlId] && window.auditLayersState[kmlId][pointKey]);

            let btnHtml = isAudited ? `
                <button onclick="window.viewAuditDetailOnly('${safePointKey}')" class="audit-btn audit-btn-view">查看</button>
                <button onclick="window.openAuditEditor(true)" class="audit-btn audit-btn-edit">修改</button>
            ` : `
                <button onclick="window.openAuditEditor(false)" class="audit-btn audit-btn-audit">清查點位</button>
            `;

            bottomControl._container.style.display = 'block';
            bottomControl._container.innerHTML = `<div class="audit-bottom-container">${btnHtml}</div>`;
        } else {
            bottomControl._container.style.display = 'none';
        }
    }

    window.addEventListener('click', () => { 
        clearTimeout(clickDebounceTimer);
        clickDebounceTimer = setTimeout(updateBottomBtnState, 150); 
    });

    (function renderStandaloneAddButton() {
        let btn = document.getElementById('btn-standalone-add-point');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'btn-standalone-add-point';
            btn.className = 'audit-btn audit-btn-add audit-btn-fixed-add';
            btn.innerHTML = '➕ 新增點位';
            document.body.appendChild(btn);
        }
        btn.onclick = (e) => { e.stopPropagation(); window.startAddCustomPoint(); };
    })();

    // ---------------------------------------------------------
    // 4. CSV 生成與 Storage 打包
    // ---------------------------------------------------------
    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos) {
        const records = window.auditLayersState[kmlId] || {};
        const features = window.mapNamespace?.allKmlFeatures || [];

        let headerArr = ["點名", "經度", "緯度", "設備狀態"];
        const photoCount = parseInt(maxPhotos) || 2;
        for (let i = 1; i <= photoCount; i++) headerArr.push(`照片${i}`);
        headerArr.push("備註");
        
        let csvContent = "\uFEFF" + headerArr.join(",") + "\n";
        const featureMap = new Map();
        features.forEach(f => {
            const key = f.properties?.name || f.properties?.title || f.id;
            if (key) featureMap.set(String(key), f);
        });

        const allKeys = new Set([...featureMap.keys(), ...Object.keys(records)]);

        allKeys.forEach(key => {
            const record = records[key];
            const feature = featureMap.get(key);
            let row = [`"${key.replace(/"/g, '""')}"`];

            let lng = record?.lng || feature?.geometry?.coordinates?.[0] || "";
            let lat = record?.lat || feature?.geometry?.coordinates?.[1] || "";
            row.push(`"${lng}"`, `"${lat}"`);

            if (record) {
                row.push(`"${String(record.deviceStatus || '正常').replace(/"/g, '""')}"`);
                for (let i = 0; i < photoCount; i++) {
                    let url = record.photos?.[i] || "";
                    let name = url ? url.split('?')[0].split('/').pop() : "";
                    row.push(`"${name.replace(/"/g, '""')}"`);
                }
                row.push(`"${String(record.note || '').replace(/"/g, '""')}"`);
            } else {
                row.push('""');
                for (let i = 0; i < photoCount; i++) row.push('""');
                row.push('""');
            }
            csvContent += row.join(",") + "\n";
        });

        try {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
            const csvStoragePath = `${STORAGE_ROOT}/${kmlLayerName}/${kmlLayerName}_清查總表.csv`;
            await firebase.storage().ref().child(csvStoragePath).put(blob, { contentType: 'text/csv' });
        } catch (err) {
            console.warn("⚠️ CSV 上傳至 Storage 失敗，降級至本地下載", err);
        }
    }

    window.uploadPhotosToStorage = async function(photos, kmlId, pointKey, kmlLayerName) {
        if (!photos || photos.length === 0) return [];
        const storageRef = firebase.storage().ref();
        const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');

        return Promise.all(photos.map(async (photoData, index) => {
            if (!photoData) return '';
            if (typeof photoData === 'string' && photoData.startsWith('http')) return photoData;

            const photoIndexStr = String(index + 1).padStart(2, '0');
            const path = `${STORAGE_ROOT}/${kmlLayerName}/${safePointKey}_${photoIndexStr}.jpg`;
            const ref = storageRef.child(path);

            let blob = (photoData instanceof Blob) ? photoData : await (await fetch(photoData)).blob();
            await ref.put(blob);
            return await ref.getDownloadURL();
        }));
    };

    window.deleteCustomPoint = async function(kmlId, pointKey, kmlLayerName) {
        const confirmRes = await Swal.fire({
            title: '確定刪除點位？',
            text: `將永久移除點位 [ ${pointKey} ] 及其照片與紀錄。`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: '確定刪除'
        });
        if (!confirmRes.isConfirmed) return;

        Swal.fire({ title: '正在刪除...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
            const safeKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');
            const storageRef = firebase.storage().ref();
            for (let i = 1; i <= 3; i++) {
                try { await storageRef.child(`${STORAGE_ROOT}/${kmlLayerName}/${safeKey}_0${i}.jpg`).delete(); } catch(e){}
            }

            await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pointKey).delete();
            delete window.auditLayersState[kmlId]?.[pointKey];

            if (window.mapNamespace?.allKmlFeatures) {
                window.mapNamespace.allKmlFeatures = window.mapNamespace.allKmlFeatures.filter(f => (f.properties?.name || f.properties?.title || f.properties?.auditPointKey) !== pointKey);
            }

            await generateLayerCsvReport(kmlId, kmlLayerName, 2);
            Swal.fire({ icon: 'success', title: '刪除成功', timer: 1000, showConfirmButton: false });
            forceMapRefresh();
            setTimeout(updateBottomBtnState, 300);
        } catch (e) {
            Swal.fire('錯誤', e.message, 'error');
        }
    };

    // ---------------------------------------------------------
    // 5. 即時數據監聽初始化
    // ---------------------------------------------------------
    const initGlobalConfigListener = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            setTimeout(initGlobalConfigListener, 500);
            return;
        }
        firebase.firestore().collection(APP_PATH).onSnapshot(snapshot => {
            snapshot.forEach(doc => { 
                const data = doc.data();
                window.globalAuditConfigs[doc.id] = data; 
                if (data.isAuditing) {
                    if (!auditUnsubscribes[doc.id]) {
                        auditUnsubscribes[doc.id] = firebase.firestore().collection(APP_PATH).doc(doc.id).collection('auditRecords')
                            .onSnapshot(s => {
                                const updates = {};
                                s.forEach(d => updates[d.id] = d.data());
                                window.auditLayersState[doc.id] = updates;
                                forceMapRefresh();
                            });
                    }
                }
            });
            forceMapRefresh();
        });
    };

    initGlobalConfigListener();
})();