/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (v4.1.0 結構重構與視窗定位版)
 */
(function() {
    'use strict';

    // ---------------------------------------------------------
    // 全域狀態與初始化配置
    // ---------------------------------------------------------
    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = window.globalAuditConfigs || {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;
    let clickDebounceTimer = null;
    let activeAddPointCleanup = null;

    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    // ---------------------------------------------------------
    // 0. 權限防護與安全轉義
    // ---------------------------------------------------------
    function getUserRole() {
        return window.currentUserRole || 
               window.userRole || 
               localStorage.getItem('userRole') || 
               sessionStorage.getItem('userRole') || 
               'guest';
    }

    function checkHasAuditPermission() {
        const role = getUserRole().toLowerCase().trim();
        return role !== 'guest' && role !== 'unapproved';
    }

    function canSeeAuditColors() {
        const role = getUserRole().toLowerCase().trim();
        return ['owner', 'editor', 'user'].includes(role);
    }

    function safeEscape(str) {
        if (str === null || str === undefined) return '';
        if (typeof str === 'number' || typeof str === 'boolean') return String(str);
        if (typeof str !== 'string') {
            try { return JSON.stringify(str); } catch (e) { return ''; }
        }
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    const escapeHtml = safeEscape;
    window.escapeHtml = safeEscape;

    // ---------------------------------------------------------
    // 1. 樣式攔截與圖層刷新 (藍/黃點控制 + 視窗鎖定還原)
    // ---------------------------------------------------------
    const AUDIT_STYLES = {
        audited: { fillColor: "#FCD770", color: "#ffffff", weight: 2, fillOpacity: 0.9, radius: 9 },   // 黃點：已清查
        unaudited: { fillColor: "#2A00D2", color: "#ffffff", weight: 2, fillOpacity: 0.85, radius: 8 }, // 藍點：未清查
        default: { fillColor: "#3498db", color: "#ffffff", weight: 1.5, fillOpacity: 0.85, radius: 8 }   // 藍點：預設/未開啟清查
    };

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
                    const style = record ? AUDIT_STYLES.audited : AUDIT_STYLES.unaudited;
                    
                    f.properties.isAudited = !!record;
                    f.properties.auditStatus = record ? (record.deviceStatus || "正常") : null;
                    f.properties.auditNote = record?.note || "";
                    f.properties.photos = record?.photos || [];
                    Object.assign(f.properties, style);
                } else {
                    f.properties.isAudited = false;
                    Object.assign(f.properties, AUDIT_STYLES.default);
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

        // 紀錄當前視窗中心與 Zoom
        const currentCenter = ns.map.getCenter();
        const currentZoom = ns.map.getZoom();

        setTimeout(() => {
            if (ns.map && typeof ns.map.invalidateSize === 'function') {
                ns.map.invalidateSize({ animate: false });
                ns.map.setView(currentCenter, currentZoom, { animate: false });
            }
        }, 100);

        const records = window.auditLayersState[kmlId] || {};
        const showAuditMode = window.globalAuditConfigs[kmlId]?.isAuditing && canSeeAuditColors();

        ns.map.eachLayer(function(layer) {
            if (layer.feature && layer.feature.properties) {
                const props = layer.feature.properties;
                const pointKey = props.name || props.title || props.id || props.auditPointKey || "未知點位";
                
                if (showAuditMode) {
                    const record = records[pointKey];
                    const style = record ? AUDIT_STYLES.audited : AUDIT_STYLES.unaudited;
                    
                    props.isAudited = !!record;
                    props.auditStatus = record ? (record.deviceStatus || "正常") : null;
                    props.photos = record?.photos || [];
                    props.auditNote = record?.note || "";

                    if (typeof layer.setStyle === 'function') layer.setStyle(style);
                } else {
                    if (typeof layer.setStyle === 'function') layer.setStyle(AUDIT_STYLES.default);
                }
            }
        });

        syncAuditUIState();
    }
    window.forceMapRefresh = forceMapRefresh;

    // ---------------------------------------------------------
    // 2. UI 控制與懸浮/底部面板管理
    // ---------------------------------------------------------
    function createUnifiedAuditButton(text, bgColor, onClickHandler) {
        const btn = document.createElement('button');
        btn.innerHTML = text;
        btn.style.cssText = `
            pointer-events: auto; background: ${bgColor}; color: #ffffff;
            border: none; padding: 8px 20px; border-radius: 25px;
            font-weight: bold; font-size: 15px; box-shadow: 0 3px 10px rgba(0,0,0,0.3);
            cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
            gap: 6px; outline: none; line-height: 1.4; white-space: nowrap;
        `;
        btn.onclick = onClickHandler;
        return btn;
    }
    window.createUnifiedAuditButton = createUnifiedAuditButton;

    function syncAuditUIState() {
        const btn = document.getElementById('btn-standalone-add-point');
        const kmlId = window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        const config = kmlId ? window.globalAuditConfigs[kmlId] : null;

        const hasPermission = checkHasAuditPermission();
        const isAuditing = !!(config && config.isAuditing === true);
        const isModalOpen = typeof Swal !== 'undefined' && Swal.isVisible();

        if (btn) {
            btn.style.setProperty('display', (hasPermission && isAuditing && !isModalOpen) ? 'inline-flex' : 'none', 'important');
        }

        updateAuditBottomMenuUI();
    }
    window.syncAuditButtonVisibility = syncAuditUIState;

    function updateAuditBottomMenuUI() {
        if (!bottomControl || !bottomControl._container) return;
        const container = bottomControl._container;
        container.innerHTML = '';

        const currentKmlId = window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        const hasPermission = checkHasAuditPermission() && canSeeAuditColors();
        const isAuditingEnabled = !!(window.globalAuditConfigs?.[currentKmlId]?.isAuditing);
        const active = window.currentSelectedPoint;
        const isModalOpen = typeof Swal !== 'undefined' && Swal.isVisible();

        if (!currentKmlId || !hasPermission || !isAuditingEnabled || !active || isModalOpen) {
            container.style.display = 'none';
            return;
        }

        const props = active.feature?.properties || active.properties || {};
        const pointKey = props.name || props.title || props.id || "未知點位";
        const currentRecords = window.auditLayersState[currentKmlId] || {};
        const isAudited = currentRecords[pointKey] !== undefined;
        const isCustom = !!(props.isCustomPoint || props.isCustom);

        container.style.display = 'flex';
        container.style.gap = '10px';

        if (isAudited) {
            container.appendChild(createUnifiedAuditButton('查看', '#e91e63', () => window.viewAuditDetailOnly(pointKey)));
            container.appendChild(createUnifiedAuditButton('修改', '#f39c12', () => window.openAuditEditor(true)));
        } else {
            container.appendChild(createUnifiedAuditButton('清查點位', '#2ecc71', () => window.openAuditEditor(false)));
        }

        if (isCustom) {
            container.appendChild(createUnifiedAuditButton('🗑️ 刪除', '#e74c3c', () => {
                const selectEl = document.getElementById('kmlLayerSelect');
                const rawName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || window.currentActiveKmlName || '預設區域';
                window.deleteCustomPoint(currentKmlId, pointKey, rawName.replace(/\.kml$/i, '').trim());
            }));
        }
    }

    window.addEventListener('click', () => { 
        clearTimeout(clickDebounceTimer);
        clickDebounceTimer = setTimeout(updateAuditBottomMenuUI, 150); 
    });

    // ---------------------------------------------------------
    // 3. 圖片壓縮與 Firebase Storage 上傳
    // ---------------------------------------------------------
    function compressImage(file, maxSize = 1920, quality = 0.82) {
        return new Promise((resolve, reject) => {
            if (typeof file === 'string') return resolve(file);
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width, height = img.height;
                    if (width > height) { if (width > maxSize) { height *= maxSize / width; width = maxSize; } } 
                    else { if (height > maxSize) { width *= maxSize / height; height = maxSize; } }
                    canvas.width = width; canvas.height = height;
                    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    window.uploadPhotosToStorage = async function(photos, kmlId, pointKey, kmlLayerName) {
        if (!photos || !Array.isArray(photos) || photos.length === 0) return [];
        if (typeof firebase === 'undefined' || !firebase.storage) {
            throw new Error("Firebase Storage SDK 未載入！");
        }

        let targetLayerName = kmlLayerName;
        if (!targetLayerName) {
            const selectEl = document.getElementById('kmlLayerSelect');
            const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || window.currentActiveKmlName || '預設區域';
            targetLayerName = rawLayerName.replace(/\.kml$/i, '').trim();
        }

        const storageRef = firebase.storage().ref();
        const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');

        return Promise.all(photos.map(async (photoData, index) => {
            if (!photoData) return '';
            if (typeof photoData === 'string' && !photoData.startsWith('data:image')) return photoData;

            const photoIndexStr = String(index + 1).padStart(2, '0');
            const customStoragePath = `${STORAGE_ROOT}/${targetLayerName}/${safePointKey}_${photoIndexStr}.jpg`;
            const ref = storageRef.child(customStoragePath);

            let blob;
            if (photoData instanceof File || photoData instanceof Blob) {
                blob = photoData;
            } else if (typeof photoData === 'string' && photoData.startsWith('data:image')) {
                blob = await (await fetch(photoData)).blob();
            } else {
                return photoData;
            }

            await ref.put(blob);
            return await ref.getDownloadURL();
        }));
    };

    // ---------------------------------------------------------
    // 4. 清查管理 Modal & 狀態設定
    // ---------------------------------------------------------
    window.showAuditActionModal = async function() {
        if (!checkHasAuditPermission()) {
            Swal.fire('權限不足', '您的帳號角色不允許管理清查狀態！', 'warning');
            return;
        }
        const select = document.getElementById('kmlLayerSelect');
        if (!select || select.options.length <= 1) return;

        let listHtml = '<div style="max-height: 380px; overflow-y: auto; text-align: left;">';
        Array.from(select.options).forEach(opt => {
            if (!opt.value) return;
            const config = window.globalAuditConfigs?.[opt.value] || {};
            const isAuditing = config.isAuditing || false;
            const targetPhotos = config.targetPhotos || 2;
            const baseName = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
            const safeValue = escapeHtml(opt.value);

            listHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid #eee;">
                    <div>
                        <div style="font-weight:bold; font-size:14px;">${escapeHtml(baseName)}</div>
                        ${isAuditing ? `<div style="color: #e67e22; font-size:12px;">清查中：需照片 ${targetPhotos} 張</div>` : `<div style="color: #999; font-size: 12px;">未開啟清查</div>`}
                    </div>
                    <div style="display:flex; gap:6px;">
                        ${isAuditing ? `<button onclick="window.downloadAuditPhotosZip('${safeValue}')" style="background:#8e44ad; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:12px;">下載照片</button>` : ''}
                        <button onclick="window.toggleAuditStatus('${safeValue}', ${!isAuditing})" style="background:${isAuditing ? '#666' : '#3498db'}; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:12px;">
                            ${isAuditing ? '關閉' : '開啟'}
                        </button>
                    </div>
                </div>`;
        });
        listHtml += '</div>';
        
        Swal.fire({ title: '圖層清查管理', html: listHtml, showConfirmButton: false, showCloseButton: true });
    };

    window.toggleAuditStatus = async function(kmlId, status) {
        if (!checkHasAuditPermission()) return;
        try {
            Swal.close(); 
            if (status) {
                const savedOptions = localStorage.getItem('audit_status_options');
                const defaultStatusStr = savedOptions ? JSON.parse(savedOptions).join(', ') : '正常, 損壞, 遺失';

                const { value: formValues } = await Swal.fire({
                    title: '⚙️ 清查模式設定',
                    html: `
                        <div style="text-align:left; font-size:14px;">
                            <div style="margin-bottom: 16px;">
                                <label style="font-weight:bold; display:block; margin-bottom:6px;">1. 設定必填照片張數 (1~12 張)</label>
                                <input id="swal-input-count" type="number" class="swal2-input" value="2" min="1" max="12" style="width:100%; margin:0; box-sizing:border-box;">
                            </div>
                            <div>
                                <label style="font-weight:bold; display:block; margin-bottom:6px;">2. 設定設備狀態選項 (用逗號分隔)</label>
                                <textarea id="swal-input-status" class="swal2-textarea" style="width:100%; height:80px; margin:0; box-sizing:border-box;">${defaultStatusStr}</textarea>
                            </div>
                        </div>`,
                    showCancelButton: true, confirmButtonText: '開啟清查', cancelButtonText: '取消',
                    preConfirm: () => {
                        const countVal = parseInt(document.getElementById('swal-input-count').value, 10);
                        const statusVal = document.getElementById('swal-input-status').value.trim();
                        if (!countVal || countVal < 1 || countVal > 12) return Swal.showValidationMessage('照片張數必須介於 1 到 12 張！');
                        if (!statusVal) return Swal.showValidationMessage('設備狀態選項不能為空！');
                        const optionsArray = statusVal.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
                        return { count: countVal, options: optionsArray };
                    }
                });

                if (formValues) {
                    localStorage.setItem('audit_status_options', JSON.stringify(formValues.options));
                    await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: true, targetPhotos: formValues.count, statusOptions: formValues.options }, { merge: true });
                    window.globalAuditConfigs[kmlId] = { ...(window.globalAuditConfigs[kmlId] || {}), isAuditing: true };
                    syncAuditUIState();
                    Swal.fire({ icon: 'success', title: '已開啟清查模式', timer: 1200, showConfirmButton: false });
                }
            } else {
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: false }, { merge: true });
                window.globalAuditConfigs[kmlId] = { ...(window.globalAuditConfigs[kmlId] || {}), isAuditing: false };
                syncAuditUIState();
                Swal.fire({ icon: 'success', title: '已關閉清查模式', timer: 1000, showConfirmButton: false });
            }
        } catch (error) {
            Swal.fire('失敗', error.message, 'error');
        }
    };

    // ---------------------------------------------------------
    // 5. 點位新增、編輯與刪除核心邏輯
    // ---------------------------------------------------------
    function setAddButtonActiveState(isActive) {
        const btn = document.getElementById('btn-standalone-add-point');
        if (!btn) return;
        btn.innerHTML = isActive ? '❌ 取消新增' : '➕ 新增點位';
        btn.style.setProperty('background-color', isActive ? '#e74c3c' : '#2ecc71', 'important');
    }

    window.startAddCustomPoint = function(kmlId) {
        if (activeAddPointCleanup) {
            activeAddPointCleanup();
            Swal.fire({ icon: 'info', title: '已取消新增點位', timer: 1000, showConfirmButton: false });
            return;
        }

        if (!checkHasAuditPermission()) return Swal.fire('權限不足', '無新增點位權限！', 'warning');
        const targetKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        if (!targetKmlId) return Swal.fire('提示', '請先選擇目標圖層！', 'info');

        const map = window.mapNamespace?.map;
        if (!map) return;

        map.getContainer().style.cursor = 'crosshair';
        setAddButtonActiveState(true);

        const handleMapClick = async function(e) {
            cleanup();
            await window.openAddPointModal(targetKmlId, e.latlng.lat, e.latlng.lng);
        };

        const cleanup = () => {
            map.off('click', handleMapClick);
            map.getContainer().style.cursor = '';
            activeAddPointCleanup = null;
            setAddButtonActiveState(false);
        };

        activeAddPointCleanup = cleanup;
        map.on('click', handleMapClick);
    };

    window.handleAddPhotoPreview = function(input, index) {
        if (input.files && input.files[0]) {
            const previewUrl = URL.createObjectURL(input.files[0]);
            const img = document.getElementById(`add-prev-${index}`);
            const icon = document.getElementById(`add-icon-${index}`);
            const tagText = document.getElementById(`add-tag-text-${index}`);
            if (img) { img.src = previewUrl; img.style.display = 'block'; }
            if (icon) icon.style.display = 'none';
            if (tagText) tagText.innerText = '已選取';
        }
    };

    window.openAddPointModal = async function(param1, param2, param3) {
        let kmlId, lat, lng, editData = null, isEditMode = false;
        if (typeof param1 === 'object' && param1 !== null) {
            editData = param1;
            kmlId = editData.kmlId; lat = editData.lat; lng = editData.lng;
            isEditMode = !!editData.isEditMode;
        } else {
            kmlId = param1; lat = param2; lng = param3;
        }

        const config = window.globalAuditConfigs?.[kmlId] || {};
        const maxPhotos = config.targetPhotos || 2; 
        const existingPhotos = editData?.photos || [];
        const defaultName = editData?.pointKey || editData?.name || '';
        const defaultRemark = editData?.note || editData?.remark || '';

        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const existingSrc = existingPhotos[i] || '';
            const hasPhoto = !!existingSrc;
            photoHtml += `
                <div style="position:relative; margin-bottom:15px; width:80px;">
                    <div style="border:2px dashed #ccc; height:80px; width:80px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:12px; overflow:hidden;">
                        <img id="add-prev-${i}" src="${existingSrc}" style="width:100%; height:100%; object-fit:cover; display:${hasPhoto ? 'block' : 'none'}; position:absolute; top:0; left:0; z-index:1;">
                        <span id="add-icon-${i}" style="font-size:24px; color:#bbb; display:${hasPhoto ? 'none' : 'block'}; z-index:1;">📷</span>
                        <input type="file" id="add-photo-input-${i}" accept="image/*" capture="environment" onchange="window.handleAddPhotoPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;">
                    </div>
                    <label for="add-photo-input-${i}" style="position:absolute; left:50%; transform:translateX(-50%); bottom:-10px; z-index:3; background:#555; color:#fff; font-size:11px; padding:2px 8px; border-radius:12px; cursor:pointer; white-space:nowrap;">
                        🖼️ <span id="add-tag-text-${i}">${hasPhoto ? '已選取' : '選擇'}</span>
                    </label>
                </div>`;
        }

        const selectEl = document.getElementById('kmlLayerSelect');
        const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || kmlId;
        const kmlLayerName = rawLayerName.replace(/\.kml$/i, '').trim();

        const { value: formValues } = await Swal.fire({
            title: isEditMode ? '✏️ 修改自訂點位' : '➕ 新增自訂點位',
            html: `
            <div style="text-align: left; font-size:14px;">
                <div style="margin-bottom: 12px;">
                    <label style="font-weight: bold;">點位名稱 <span style="color:red;">*</span></label>
                    <input type="text" id="add-point-name" class="swal2-input" value="${escapeHtml(defaultName)}" style="width:100%; margin:4px 0 0 0; box-sizing:border-box;">
                </div>
                <div style="margin-bottom: 12px;">
                    <label style="font-weight: bold;">現場照片 (需滿 ${maxPhotos} 張) <span style="color:red;">*</span></label>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top:6px;">${photoHtml}</div>
                </div>
                <div>
                    <label style="font-weight: bold;">備註事項</label>
                    <textarea id="add-point-remark" class="swal2-textarea" style="width:100%; height:70px; margin:4px 0 0 0; box-sizing:border-box;">${escapeHtml(defaultRemark)}</textarea>
                </div>
            </div>`,
            showCancelButton: true, confirmButtonText: isEditMode ? '儲存修改' : '確認新增', cancelButtonText: '取消',
            didOpen: () => syncAuditUIState(),
            willClose: () => syncAuditUIState(),
            preConfirm: () => {
                const name = document.getElementById('add-point-name').value.trim();
                const remark = document.getElementById('add-point-remark').value.trim();
                const photosArray = [];
                for (let i = 0; i < maxPhotos; i++) {
                    const fileInput = document.getElementById(`add-photo-input-${i}`);
                    const img = document.getElementById(`add-prev-${i}`);
                    if (fileInput?.files?.[0]) photosArray.push(fileInput.files[0]);
                    else if (img?.src && !img.src.startsWith('blob:') && img.src !== window.location.href) photosArray.push(img.src);
                }
                if (!name) return Swal.showValidationMessage('請填寫點位名稱！');
                if (photosArray.length < maxPhotos) return Swal.showValidationMessage(`請填滿 ${maxPhotos} 張照片！`);

                return { kmlId, kmlLayerName, lat, lng, pointKey: name, name, status: "新增", deviceStatus: "新增", remark, photos: photosArray, isEditMode, oldPointKey: isEditMode ? defaultName : null };
            }
        });

        if (formValues) await window.submitNewCustomPoint(formValues);
    };
    window.openCustomPointModal = window.openAddPointModal;

    window.submitNewCustomPoint = async function(formValues) {
        const { kmlId, kmlLayerName, lat, lng, pointKey, deviceStatus, remark, photos, isEditMode, oldPointKey } = formValues;
        const trimmedPointKey = (pointKey || '').trim();
        const numLat = parseFloat(lat), numLng = parseFloat(lng);

        const ns = window.mapNamespace;
        const savedCenter = ns?.map ? ns.map.getCenter() : null;
        const savedZoom = ns?.map ? ns.map.getZoom() : null;

        Swal.fire({ title: '正在處理並儲存資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

        try {
            const photoUrls = await window.uploadPhotosToStorage(photos, kmlId, trimmedPointKey, kmlLayerName);

            if (isEditMode && oldPointKey && oldPointKey !== trimmedPointKey) {
                delete window.auditLayersState?.[kmlId]?.[oldPointKey];
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(oldPointKey).delete();
            }

            const structuredData = {
                pointName: trimmedPointKey,
                status: "已完成", deviceStatus: deviceStatus || "新增", auditStatus: deviceStatus || "新增",
                note: remark || "", photos: photoUrls, lat: numLat, lng: numLng, isCustomPoint: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
            window.auditLayersState[kmlId][trimmedPointKey] = structuredData;

            await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(trimmedPointKey).set(structuredData, { merge: true });

            const newFeature = {
                type: "Feature",
                geometry: { type: "Point", coordinates: [numLng, numLat] },
                properties: {
                    name: trimmedPointKey,
                    title: trimmedPointKey,
                    kmlId: kmlId,
                    isCustomPoint: true,
                    auditPointKey: trimmedPointKey,
                    isAudited: true
                }
            };

            if (ns && ns.map) {
                if (isEditMode && oldPointKey) {
                    ns.map.eachLayer(layer => {
                        const pk = layer.feature?.properties?.auditPointKey || layer.feature?.properties?.name;
                        if (pk === oldPointKey) {
                            ns.map.removeLayer(layer);
                        }
                    });
                }

                if (typeof L !== 'undefined' && L.geoJSON) {
                    L.geoJSON(newFeature, {
                        pointToLayer: function(feature, latlng) {
                            return L.circleMarker(latlng, AUDIT_STYLES.audited);
                        },
                        onEachFeature: function(feature, layer) {
                            layer.feature = feature;
                        }
                    }).addTo(ns.map);
                }

                if (savedCenter && savedZoom) {
                    ns.map.setView(savedCenter, savedZoom, { animate: false });
                }
            }

            Swal.fire({ icon: 'success', title: isEditMode ? '修改點位成功' : '新增點位成功', timer: 1200, showConfirmButton: false });
            forceMapRefresh();
        } catch (e) {
            Swal.fire('錯誤', e.message || '儲存失敗', 'error');
        }
    };

    window.deleteCustomPoint = async function(kmlId, pointKey, kmlLayerName) {
        if (!kmlId || !pointKey) return Swal.fire('錯誤', '無效的點位資訊', 'error');

        const confirmRes = await Swal.fire({
            title: '確定要刪除此點位？',
            text: `將永久刪除點位「${pointKey}」及其照片與紀錄！`,
            icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: '確定刪除', cancelButtonText: '取消'
        });
        if (!confirmRes.isConfirmed) return;

        Swal.fire({ title: '正在刪除點位與照片...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

        try {
            const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');
            const targetLayer = kmlLayerName || 'default_layer';
            const storageRef = firebase.storage().ref();

            await Promise.all(Array.from({ length: 12 }, (_, i) => {
                const idx = String(i + 1).padStart(2, '0');
                return storageRef.child(`${STORAGE_ROOT}/${targetLayer}/${safePointKey}_${idx}.jpg`).delete().catch(() => {});
            }));

            await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pointKey).delete();

            if (window.auditLayersState?.[kmlId]) delete window.auditLayersState[kmlId][pointKey];

            const ns = window.mapNamespace;
            if (ns && Array.isArray(ns.allKmlFeatures)) {
                ns.allKmlFeatures = ns.allKmlFeatures.filter(f => (f.properties?.name || f.properties?.title) !== pointKey);
            }

            window.currentSelectedPoint = null;
            Swal.fire({ icon: 'success', title: '點位已成功刪除', timer: 1200, showConfirmButton: false });
            forceMapRefresh();
        } catch (e) {
            Swal.fire('錯誤', e.message || '刪除失敗', 'error');
        }
    };

    // ---------------------------------------------------------
    // 6. 清查紀錄編輯與檢視 (Audit Record Editor & View)
    // ---------------------------------------------------------
    window.openAuditEditor = async function(isModifyMode = false) {
        if (!checkHasAuditPermission()) return;
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) return;

        const layerProps = activePoint.feature?.properties || activePoint.properties || {};
        const pointKey = layerProps.name || layerProps.title || layerProps.id || "未知點位"; 
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs?.[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos || 2;

        const selectEl = document.getElementById('kmlLayerSelect');
        const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '預設區域';
        const kmlLayerName = rawLayerName.replace(/\.kml$/i, '').trim(); 
        const historyRecord = isModifyMode ? (window.auditLayersState?.[kmlId]?.[pointKey] || {}) : {};

        const currentPhotos = new Array(maxPhotos).fill('');
        if (isModifyMode && Array.isArray(historyRecord.photos)) {
            historyRecord.photos.forEach((url, idx) => { if (idx < maxPhotos) currentPhotos[idx] = url || ''; });
        }

        const baseStatusOptions = config.statusOptions || (localStorage.getItem('audit_status_options') ? JSON.parse(localStorage.getItem('audit_status_options')) : ['正常','損壞','遺失']);
        const statusOptionsHtml = baseStatusOptions.map(opt => `<option value="${opt}" ${historyRecord.deviceStatus === opt ? 'selected' : ''}>${opt}</option>`).join('');

        window._tempPreview = async function(input, index) {
            if (input.files && input.files[0]) {
                const base64 = await compressImage(input.files[0]);
                const prevEl = document.getElementById('audit-prev-' + index);
                const iconEl = document.getElementById('audit-icon-' + index);
                if (prevEl) { prevEl.src = base64; prevEl.style.display = 'block'; }
                if (iconEl) iconEl.style.display = 'none';
                currentPhotos[index] = base64;
            }
        };

        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const photoData = currentPhotos[i] || '';
            photoHtml += `
                <div style="position:relative;">
                    <div style="border:2px dashed #ccc; height:85px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:8px; overflow:hidden;">
                        <img id="audit-prev-${i}" src="${photoData}" style="width:100%; height:100%; object-fit:cover; display:${photoData ? 'block' : 'none'}; position:absolute; top:0; left:0; z-index:1;">
                        <span id="audit-icon-${i}" style="font-size:24px; color:#bbb; display:${photoData ? 'none' : 'block'}; z-index:1;">📷</span>
                        <input type="file" accept="image/*" capture="environment" onchange="window._tempPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;">
                    </div>
                </div>`;
        }

        const { value: res } = await Swal.fire({
            title: `${isModifyMode ? '修改' : '填寫'}清查紀錄：${escapeHtml(pointKey)}`,
            html: `<div style="text-align:left; font-size:14px;">
                <label style="font-weight:bold;">設備狀態 <span style="color:red;">*</span></label>
                <select id="swal-status" class="swal2-input" style="width:100%; margin:6px 0 12px 0;">
                    <option value="">--- 請選擇狀態 ---</option>
                    ${statusOptionsHtml}
                </select>
                <label style="font-weight:bold;">現場照片 (需滿 ${maxPhotos} 張) <span style="color:red;">*</span></label>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(90px, 1fr)); gap:10px; margin:8px 0 12px 0;">${photoHtml}</div>
                <label style="font-weight:bold;">備註事項</label>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%; height:70px; margin:6px 0 0 0;">${escapeHtml(historyRecord.note || '')}</textarea>
            </div>`,
            showCancelButton: true, confirmButtonText: isModifyMode ? '覆蓋更新' : '確認上傳', cancelButtonText: '取消',
            preConfirm: () => {
                const statusValue = document.getElementById('swal-status').value;
                if (!statusValue) return Swal.showValidationMessage('請選擇設備狀態');
                const validPhotos = currentPhotos.filter(p => p && p.trim() !== '');
                if (validPhotos.length < maxPhotos) return Swal.showValidationMessage(`請補滿 ${maxPhotos} 張照片`);
                return { status: statusValue, note: document.getElementById('swal-note').value, photos: currentPhotos };
            }
        });

        delete window._tempPreview;

        if (res) {
            Swal.fire({ title: '正在上傳與更新...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const photoUrls = await window.uploadPhotosToStorage(res.photos, kmlId, pointKey, kmlLayerName);
                const structuredData = { pointName: pointKey, status: "已完成", deviceStatus: res.status, note: res.note, photos: photoUrls, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][pointKey] = structuredData;

                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pointKey).set(structuredData, { merge: true });

                if (typeof generateLayerCsvReport === 'function') await generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos);

                Swal.fire({ icon: 'success', title: '更新成功', timer: 1000, showConfirmButton: false });
                forceMapRefresh();
            } catch (e) { Swal.fire('錯誤', e.message || '儲存失敗', 'error'); }
        }
    };

    window.viewAuditDetailOnly = function(pointKey) {
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const record = window.auditLayersState[kmlId]?.[pointKey];
        if (!record) return;

        let imagesHtml = (record.photos || []).map(url => url ? `<img src="${escapeHtml(url)}" style="width:45%; margin:2%; max-height:120px; object-fit:cover; border-radius:6px; border:1px solid #ccc;">` : '').join('');

        Swal.fire({
            title: `清查紀錄：${escapeHtml(pointKey)}`,
            html: `<div style="text-align: left; font-size:14px;">
                <p><b>設備狀況：</b><span style="color:#e91e63; font-weight:bold;">🟢 ${escapeHtml(record.deviceStatus || '正常')}</span></p>
                <p><b>現場備註：</b><br>${escapeHtml(record.note || '無備註')}</p>
                <p><b>現場照片：</b></p>
                <div style="display:flex; flex-wrap:wrap;">${imagesHtml || '無照片'}</div>
            </div>`,
            confirmButtonText: '關閉'
        });
    };

    // ---------------------------------------------------------
    // 7. CSV 總表與打包照片 ZIP 下載
    // ---------------------------------------------------------
    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos) {
        const activeKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        const records = window.auditLayersState?.[activeKmlId] || {};
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

        const allPointKeys = new Set([...featureMap.keys(), ...Object.keys(records)]);

        allPointKeys.forEach(pointKey => {
            const record = records[pointKey]; 
            const feature = featureMap.get(pointKey);
            let rowArr = [`"${pointKey.replace(/"/g, '""')}"`];

            let lng = record?.lng || feature?.geometry?.coordinates?.[0] || "";
            let lat = record?.lat || feature?.geometry?.coordinates?.[1] || "";
            rowArr.push(`"${lng}"`, `"${lat}"`);

            if (record) {
                rowArr.push(`"${String(record.deviceStatus || '正常').replace(/"/g, '""')}"`);
                for (let i = 0; i < photoCount; i++) rowArr.push(`"${String(record.photos?.[i] || '').replace(/"/g, '""')}"`);
                rowArr.push(`"${String(record.note || '').replace(/"/g, '""')}"`);
            } else {
                rowArr.push('""');
                for (let i = 0; i < photoCount; i++) rowArr.push('""');
                rowArr.push('""');
            }
            csvContent += rowArr.join(",") + "\n";
        });

        try {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
            const safeLayerName = kmlLayerName || 'default_layer';
            await firebase.storage().ref().child(`${STORAGE_ROOT}/${safeLayerName}/${safeLayerName}_清查總表.csv`).put(blob, { contentType: 'text/csv' });
        } catch (err) {
            const link = document.createElement("a");
            link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
            link.download = `${kmlLayerName || '清查'}_總表.csv`;
            link.click();
        }
    }

    window.downloadAuditPhotosZip = async function(kmlId) {
        if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
            return Swal.fire('套件缺失', '請確保已引入 JSZip 與 FileSaver 套件！', 'error');
        }

        const rawRole = window.currentUserData?.role || window.currentUserRole || window.currentUser?.role;
        if (!['owner', 'editor'].includes(rawRole?.toString().trim().toLowerCase())) {
            return Swal.fire('權限不足', '僅 Editor/Owner 可下載打包照片！', 'warning');
        }

        const selectEl = document.getElementById('kmlLayerSelect');
        const opt = selectEl ? Array.from(selectEl.options).find(o => o.value === kmlId) : null;
        const cleanLayerName = (opt ? opt.getAttribute('data-basename') : kmlId).replace(/\.kml$/i, '').trim();

        Swal.fire({ title: '正在打包照片...', html: `<div id="zip-progress">檢索中...</div>`, allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        try {
            const listResult = await firebase.storage().ref(`${STORAGE_ROOT}/${cleanLayerName}`).listAll();
            if (listResult.items.length === 0) return Swal.fire('提示', '沒有找到任何照片檔案。', 'info');

            const zip = new JSZip();
            const folder = zip.folder(cleanLayerName);
            let count = 0;

            for (const item of listResult.items) {
                const url = await item.getDownloadURL();
                const blob = await (await fetch(url)).blob();
                folder.file(item.name, blob);
                count++;
                document.getElementById('zip-progress').textContent = `下載進度: (${count}/${listResult.items.length})`;
            }

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            saveAs(zipBlob, `${cleanLayerName}_照片總集.zip`);
            Swal.fire({ icon: 'success', title: '打包完成！', timer: 2000, showConfirmButton: false });
        } catch (err) {
            Swal.fire('打包失敗', err.message, 'error');
        }
    };

    // ---------------------------------------------------------
    // 8. 實時監聽與地圖初始化掛載
    // ---------------------------------------------------------
    const initGlobalConfigListener = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) return setTimeout(initGlobalConfigListener, 500);

        firebase.firestore().collection(APP_PATH).onSnapshot(snapshot => {
            snapshot.forEach(doc => { 
                const data = doc.data();
                window.globalAuditConfigs[doc.id] = data; 
                if (data.isAuditing) startAuditDataListener(doc.id);
            });
            updateKmlSelectUI();
            forceMapRefresh();
        });
    };

    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        auditUnsubscribes[kmlId] = firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snapshot => {
                const updates = {};
                snapshot.forEach(doc => updates[doc.id] = doc.data());
                window.auditLayersState[kmlId] = updates;
                forceMapRefresh(); 
            });
    }

    function updateKmlSelectUI() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select) return;
        Array.from(select.options).forEach(opt => {
            if (!opt.value) return;
            const config = window.globalAuditConfigs[opt.value];
            const baseName = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
            if (!opt.getAttribute('data-basename')) opt.setAttribute('data-basename', baseName);
            opt.textContent = config?.isAuditing ? `${baseName} (清查中:${config.targetPhotos}張)` : baseName;
        });
    }

    const checkMapInterval = setInterval(() => {
        if (window.mapNamespace?.map && typeof L !== 'undefined') {
            clearInterval(checkMapInterval);
            const map = window.mapNamespace.map;

            map.on('moveend zoomend resize', () => setTimeout(() => map.invalidateSize({ animate: false }), 100));

            const AuditMenu = L.Control.extend({
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                    this._container.style.cssText = 'display:none; position:fixed; bottom:35px; left:50%; transform:translateX(-50%); z-index:5000; pointer-events:none; background:transparent; padding:0;';
                    return this._container;
                }
            });
            bottomControl = new AuditMenu();
            bottomControl.addTo(map);

            let btn = document.getElementById('btn-standalone-add-point');
            if (!btn) {
                btn = document.createElement('button');
                btn.id = 'btn-standalone-add-point';
                btn.innerHTML = '➕ 新增點位';
                document.body.appendChild(btn);
            }
            btn.style.cssText = 'position:fixed !important; bottom:20px !important; right:15px !important; z-index:4000 !important; background-color:#2ecc71 !important; color:#fff !important; border:none !important; padding:8px 20px !important; border-radius:25px !important; font-weight:bold !important; cursor:pointer !important; display:none; outline:none !important;';
            btn.onclick = (e) => { e.stopPropagation(); window.startAddCustomPoint(); };

            initGlobalConfigListener();
        }
    }, 500);

})();