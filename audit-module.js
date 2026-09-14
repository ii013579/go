/**
 * ============================================================================
 * Audit & Site Verification Module (v3.16 Final Production Version)
 * 包含：自帶 CSS 樣式、Firebase v8 相容語法、地圖點擊綁定與延遲初始化
 * ============================================================================
 */

(function (window, document) {
    'use strict';

    // ------------------------------------------------------------------------
    // Dynamic Style Injection (動態注入模組專用 CSS)
    // ------------------------------------------------------------------------
    (function injectStyles() {
        if (document.getElementById('audit-module-styles')) return;
        const style = document.createElement('style');
        style.id = 'audit-module-styles';
        style.textContent = `
            .audit-mode-active .leaflet-container {
                cursor: crosshair !important;
            }
            .btn-standalone-add-point {
                position: fixed;
                bottom: 25px;
                right: 25px;
                z-index: 1000;
                background-color: #28a745;
                color: #ffffff;
                border: none;
                border-radius: 50px;
                padding: 12px 20px;
                font-size: 15px;
                font-weight: bold;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
                cursor: pointer;
                display: none;
                align-items: center;
                gap: 8px;
                transition: transform 0.2s, background-color 0.2s;
            }
            .btn-standalone-add-point:hover {
                background-color: #218838;
                transform: scale(1.05);
            }
            .photo-preview-container {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                min-height: 60px;
                background: #f8f9fa;
                border: 1px dashed #cccccc;
                padding: 8px;
                border-radius: 6px;
                margin-bottom: 12px;
                max-height: 180px;
                overflow-y: auto;
            }
            .photo-preview-item {
                position: relative;
                display: inline-block;
                width: 75px;
                height: 75px;
            }
            .photo-preview-item img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                border-radius: 6px;
                border: 1px solid #ddd;
            }
            .photo-preview-item .btn-remove-photo {
                position: absolute;
                top: -6px;
                right: -6px;
                background: #dc3545;
                color: #ffffff;
                border: none;
                border-radius: 50%;
                width: 20px;
                height: 20px;
                font-size: 12px;
                line-height: 18px;
                text-align: center;
                cursor: pointer;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            }
        `;
        document.head.appendChild(style);
    })();

    // ------------------------------------------------------------------------
    // 0. Helper Utilities (輔助函式庫)
    // ------------------------------------------------------------------------
    function getPointKey(props = {}) {
        return props.auditPointKey || props.name || props.title || props.id || "未知點位";
    }

    function getCleanLayerName(kmlId) {
        const selectEl = document.getElementById('kmlLayerSelect');
        const opt = selectEl ? Array.from(selectEl.options).find(o => o.value === kmlId) : null;
        const rawName = opt?.getAttribute('data-basename') || opt?.textContent.split(' (')[0] || window.currentActiveKmlName || kmlId || 'default_layer';
        return rawName.replace(/\.kml$/i, '').trim();
    }

    function compressImageToBase64(file, maxWidth = 1280, quality = 0.7) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // ------------------------------------------------------------------------
    // 1. 全域狀態管理與初始化 (State & Global Setup)
    // ------------------------------------------------------------------------
    window.AuditModule = window.AuditModule || {
        isAuditMode: false,
        auditDataStore: {},     
        customPointsStore: {},  
        activeKmlId: null,
        _mapClickHandler: null,

        toggleAuditMode(enable) {
            this.isAuditMode = typeof enable === 'boolean' ? enable : !this.isAuditMode;
            document.body.classList.toggle('audit-mode-active', this.isAuditMode);
            this.updateAuditBottomMenuUI();
            this.bindMapClickEvents();
            
            if (typeof window.refreshCurrentLayerDisplay === 'function') {
                window.refreshCurrentLayerDisplay();
            }
        },

        updateAuditBottomMenuUI() {
            let btnAddPoint = document.getElementById('btn-standalone-add-point');
            
            if (!btnAddPoint) {
                btnAddPoint = document.createElement('button');
                btnAddPoint.id = 'btn-standalone-add-point';
                btnAddPoint.className = 'btn-standalone-add-point';
                btnAddPoint.innerHTML = `📍 新增現場點位`;
                btnAddPoint.addEventListener('click', () => {
                    if (window.map) {
                        const center = window.map.getCenter();
                        window.openAddPointModal(center.lat, center.lng);
                    } else {
                        if (typeof Swal !== 'undefined') {
                            Swal.fire('提示', '無法存取地圖物件', 'warning');
                        }
                    }
                });
                document.body.appendChild(btnAddPoint);
            }

            btnAddPoint.style.display = this.isAuditMode ? 'flex' : 'none';
        },

        bindMapClickEvents() {
            if (!window.map) return;
            
            if (this._mapClickHandler) {
                window.map.off('click', this._mapClickHandler);
                this._mapClickHandler = null;
            }

            if (this.isAuditMode) {
                this._mapClickHandler = (e) => {
                    if (e.originalEvent && e.originalEvent._stopped) return;
                    window.openAddPointModal(e.latlng.lat, e.latlng.lng);
                };
                window.map.on('click', this._mapClickHandler);
            }
        },

        async loadAuditDataFromFirestore(layerName) {
            if (!layerName) return;
            const cleanName = getCleanLayerName(layerName);
            if (typeof firebase === 'undefined' || !firebase.firestore) return;
            const db = firebase.firestore();

            try {
                const auditSnap = await db.collection('audit_records').where('layerName', '==', cleanName).get();
                if (!this.auditDataStore[cleanName]) this.auditDataStore[cleanName] = {};
                auditSnap.forEach(doc => {
                    const data = doc.data();
                    this.auditDataStore[cleanName][data.pointKey] = data;
                });

                const customSnap = await db.collection('custom_points').where('layerName', '==', cleanName).get();
                this.customPointsStore[cleanName] = [];
                customSnap.forEach(doc => {
                    this.customPointsStore[cleanName].push(doc.data().geoJSON);
                });

            } catch (err) {
                console.error("Firestore 資料載入失敗:", err);
            }
        }
    };

    // ------------------------------------------------------------------------
    // 2. Storage 檔案處理與上傳模組 (Firebase v8)
    // ------------------------------------------------------------------------
    const AuditStorage = {
        async uploadPhotos(layerName, pointKey, filesArray) {
            if (!filesArray || filesArray.length === 0) return [];
            if (typeof firebase === 'undefined' || !firebase.storage) return [];
            
            const storage = firebase.storage();
            const uploadPromises = filesArray.map(async (fileObj, index) => {
                if (typeof fileObj === 'string' && fileObj.startsWith('http')) {
                    return fileObj;
                }
                
                const file = fileObj.file || fileObj;
                const timestamp = Date.now();
                const sanitizedKey = encodeURIComponent(pointKey);
                const path = `audit_photos/${layerName}/${sanitizedKey}/${timestamp}_${index}.jpg`;
                const storageRef = storage.ref().child(path);

                await storageRef.put(file);
                return await storageRef.getDownloadURL();
            });

            return Promise.all(uploadPromises);
        }
    };

    // ------------------------------------------------------------------------
    // 3. 模組化彈窗 (Unified Modal Controller)
    // ------------------------------------------------------------------------
    async function openAuditDialog(options = {}) {
        const {
            title = "編輯巡檢紀錄",
            layerName,
            pointKey,
            initialData = {},
            isCustomPoint = false,
            onSave = async () => {}
        } = options;

        let tempPhotos = (initialData.photos || []).map(p => {
            return typeof p === 'string' ? { url: p, preview: p } : p;
        });

        const statusOptions = isCustomPoint 
            ? `<option value="新增" selected>新增 (自訂點位)</option>`
            : `
                <option value="正常" ${initialData.status === '正常' ? 'selected' : ''}>正常</option>
                <option value="異常" ${initialData.status === '異常' ? 'selected' : ''}>異常</option>
                <option value="待處理" ${initialData.status === '待處理' ? 'selected' : ''}>待處理</option>
              `;

        const renderPhotoGrid = () => {
            if (tempPhotos.length === 0) {
                return `<div style="color:#888; font-size:12px; text-align:center; padding-top:15px; width:100%;">暫無照片</div>`;
            }
            return tempPhotos.map((p, idx) => `
                <div class="photo-preview-item">
                    <img src="${p.preview || p.url}">
                    <button type="button" data-idx="${idx}" class="btn-remove-photo">×</button>
                </div>
            `).join('');
        };

        const htmlContent = `
            <div style="text-align:left; font-size:14px; color:#333;">
                <p style="margin-bottom:6px;"><strong>圖層：</strong>${layerName}</p>
                <p style="margin-bottom:12px;"><strong>點位：</strong>${pointKey}</p>
                
                <label style="display:block; margin-bottom:4px; font-weight:bold;">設備狀態：</label>
                <select id="swal-audit-status" class="swal2-input" style="width:100%; height:38px; margin:0 0 12px 0;" ${isCustomPoint ? 'disabled' : ''}>
                    ${statusOptions}
                </select>

                <label style="display:block; margin-bottom:4px; font-weight:bold;">現場照片：</label>
                <input type="file" id="swal-audit-file" accept="image/*" multiple style="display:none;">
                <button type="button" id="swal-btn-upload" class="swal2-confirm swal2-styled" style="background-color:#6c757d; margin:0 0 8px 0; padding:6px 12px; font-size:12px;">📷 拍攝 / 選擇照片</button>
                
                <div id="swal-photo-container" class="photo-preview-container">
                    ${renderPhotoGrid()}
                </div>

                <label style="display:block; margin-bottom:4px; font-weight:bold;">現場備註：</label>
                <textarea id="swal-audit-memo" class="swal2-textarea" style="width:100%; margin:0; height:70px; resize:vertical;" placeholder="輸入現場維修狀況、注意事項...">${initialData.memo || ''}</textarea>
            </div>
        `;

        const { isConfirmed } = await Swal.fire({
            title: title,
            html: htmlContent,
            showCancelButton: true,
            confirmButtonText: '儲存並同步',
            cancelButtonText: '取消',
            focusConfirm: false,
            didOpen: () => {
                const fileInput = document.getElementById('swal-audit-file');
                const uploadBtn = document.getElementById('swal-btn-upload');
                const container = document.getElementById('swal-photo-container');

                uploadBtn.addEventListener('click', () => fileInput.click());

                fileInput.addEventListener('change', async (e) => {
                    const files = Array.from(e.target.files);
                    for (const file of files) {
                        try {
                            const base64 = await compressImageToBase64(file);
                            tempPhotos.push({ file, preview: base64 });
                        } catch (err) {
                            console.error("照片轉換失敗:", err);
                        }
                    }
                    container.innerHTML = renderPhotoGrid();
                });

                container.addEventListener('click', (e) => {
                    if (e.target.classList.contains('btn-remove-photo')) {
                        const idx = parseInt(e.target.getAttribute('data-idx'), 10);
                        tempPhotos.splice(idx, 1);
                        container.innerHTML = renderPhotoGrid();
                    }
                });
            }
        });

        if (isConfirmed) {
            Swal.fire({ title: '處理中...', text: '正在上傳照片與同步資料', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            
            try {
                const status = document.getElementById('swal-audit-status').value;
                const memo = document.getElementById('swal-audit-memo').value;

                const existingUrls = tempPhotos.filter(p => p.url && !p.file).map(p => p.url);
                const newFiles = tempPhotos.filter(p => p.file).map(p => p.file);

                const uploadedUrls = await AuditStorage.uploadPhotos(layerName, pointKey, newFiles);
                const finalPhotos = [...existingUrls, ...uploadedUrls];

                const resultPayload = {
                    status,
                    memo,
                    photos: finalPhotos,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                await onSave(resultPayload);
                Swal.fire('成功', '紀錄已成功更新', 'success');
            } catch (err) {
                console.error("儲存失敗:", err);
                Swal.fire('錯誤', '資料儲存過程發生異常', 'error');
            }
        }
    }

    // ------------------------------------------------------------------------
    // 4. API 介面點與觸發函式 (Public API Actions)
    // ------------------------------------------------------------------------
    window.openAuditEditor = async function (kmlId, featureProps, lat, lng) {
        const layerName = getCleanLayerName(kmlId);
        const pointKey = getPointKey(featureProps);

        const existingData = (window.AuditModule.auditDataStore[layerName] && window.AuditModule.auditDataStore[layerName][pointKey]) || {};

        await openAuditDialog({
            title: `巡檢紀錄 - ${pointKey}`,
            layerName,
            pointKey,
            initialData: existingData,
            isCustomPoint: false,
            onSave: async (payload) => {
                const db = firebase.firestore();
                const docRef = db.collection('audit_records').doc(`${layerName}_${pointKey}`);
                
                await docRef.set({
                    layerName,
                    pointKey,
                    lat,
                    lng,
                    ...payload
                }, { merge: true });

                if (!window.AuditModule.auditDataStore[layerName]) {
                    window.AuditModule.auditDataStore[layerName] = {};
                }
                window.AuditModule.auditDataStore[layerName][pointKey] = payload;

                if (typeof window.refreshCurrentLayerDisplay === 'function') {
                    window.refreshCurrentLayerDisplay();
                }
            }
        });
    };

    window.openAddPointModal = async function (lat, lng) {
        const activeKmlId = window.AuditModule.activeKmlId || document.getElementById('kmlLayerSelect')?.value;
        const layerName = getCleanLayerName(activeKmlId);
        const autoPointKey = `新增點位_${Date.now().toString().slice(-4)}`;

        await openAuditDialog({
            title: "新增自訂點位",
            layerName,
            pointKey: autoPointKey,
            initialData: { status: '新增' },
            isCustomPoint: true,
            onSave: async (payload) => {
                const db = firebase.firestore();
                const customPointGeoJSON = {
                    type: "Feature",
                    geometry: {
                        type: "Point",
                        coordinates: [lng, lat]
                    },
                    properties: {
                        auditPointKey: autoPointKey,
                        name: autoPointKey,
                        isCustom: true,
                        layerName: layerName,
                        ...payload
                    }
                };

                await db.collection('custom_points').add({
                    layerName,
                    pointKey: autoPointKey,
                    geoJSON: customPointGeoJSON,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                if (!window.AuditModule.customPointsStore[layerName]) {
                    window.AuditModule.customPointsStore[layerName] = [];
                }
                window.AuditModule.customPointsStore[layerName].push(customPointGeoJSON);

                if (typeof window.refreshCurrentLayerDisplay === 'function') {
                    window.refreshCurrentLayerDisplay();
                }
            }
        });
    };

    window.deleteCustomPoint = async function (layerName, pointKey) {
        const confirm = await Swal.fire({
            title: '確認刪除？',
            text: `確定要刪除自訂點位「${pointKey}」嗎？`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: '刪除',
            cancelButtonText: '取消'
        });

        if (confirm.isConfirmed) {
            Swal.fire({ title: '刪除中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            
            try {
                const db = firebase.firestore();
                const snapshot = await db.collection('custom_points')
                    .where('layerName', '==', layerName)
                    .where('pointKey', '==', pointKey)
                    .get();

                const batch = db.batch();
                snapshot.forEach(doc => batch.delete(doc.ref));
                await batch.commit();

                if (window.AuditModule.customPointsStore[layerName]) {
                    window.AuditModule.customPointsStore[layerName] = 
                        window.AuditModule.customPointsStore[layerName].filter(p => getPointKey(p.properties) !== pointKey);
                }

                Swal.fire('已刪除', '該點位已順利移除', 'success');
                
                if (typeof window.refreshCurrentLayerDisplay === 'function') {
                    window.refreshCurrentLayerDisplay();
                }
            } catch (err) {
                console.error("刪除點位失敗:", err);
                Swal.fire('錯誤', '無法刪除該點位', 'error');
            }
        }
    };

    // ------------------------------------------------------------------------
    // 5. 延遲初始化控制 (與 v3.15 相同的 500ms 緩衝保護)
    // ------------------------------------------------------------------------
    setTimeout(() => {
        if (window.AuditModule && typeof window.AuditModule.updateAuditBottomMenuUI === 'function') {
            window.AuditModule.updateAuditBottomMenuUI();
        }
    }, 500);

})(window, document);