/**
 * ============================================================================
 * Audit & Site Verification Module (v3.16 Core JS)
 * ============================================================================
 */
(function (window, document) {
    'use strict';

    // 0. 通用 Helper
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
                    let width = img.width, height = img.height;
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

    // 1. 全域 AuditModule 狀態管理
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
            let btnAdd = document.getElementById('btn-standalone-add-point');
            if (!btnAdd) {
                btnAdd = document.createElement('button');
                btnAdd.id = 'btn-standalone-add-point';
                btnAdd.className = 'btn-standalone-add-point';
                btnAdd.innerHTML = `📍 新增現場點位`;
                btnAdd.addEventListener('click', () => {
                    if (window.map) {
                        const center = window.map.getCenter();
                        window.openAddPointModal(center.lat, center.lng);
                    }
                });
                document.body.appendChild(btnAdd);
            }
            btnAdd.style.display = this.isAuditMode ? 'flex' : 'none';
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
            if (!layerName || typeof firebase === 'undefined' || !firebase.firestore) return;
            const cleanName = getCleanLayerName(layerName);
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

    // 2. Storage 上傳機制
    const AuditStorage = {
        async uploadPhotos(layerName, pointKey, filesArray) {
            if (!filesArray || filesArray.length === 0 || typeof firebase === 'undefined' || !firebase.storage) return [];
            const storage = firebase.storage();
            const promises = filesArray.map(async (fileObj, index) => {
                if (typeof fileObj === 'string' && fileObj.startsWith('http')) return fileObj;
                const file = fileObj.file || fileObj;
                const path = `audit_photos/${layerName}/${encodeURIComponent(pointKey)}/${Date.now()}_${index}.jpg`;
                const ref = storage.ref().child(path);
                await ref.put(file);
                return await ref.getDownloadURL();
            });
            return Promise.all(promises);
        }
    };

    // 3. 模組化彈窗 Controller
    async function openAuditDialog(options = {}) {
        const { title, layerName, pointKey, initialData = {}, isCustomPoint = false, onSave } = options;
        let tempPhotos = (initialData.photos || []).map(p => typeof p === 'string' ? { url: p, preview: p } : p);

        const renderPhotoGrid = () => {
            if (tempPhotos.length === 0) return `<div style="color:#888; font-size:12px; text-align:center; padding-top:15px; width:100%;">暫無照片</div>`;
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
                <label style="display:block; font-weight:bold;">設備狀態：</label>
                <select id="swal-audit-status" class="swal2-input" style="width:100%; height:38px; margin:4px 0 12px 0;" ${isCustomPoint ? 'disabled' : ''}>
                    ${isCustomPoint ? '<option value="新增">新增 (自訂點位)</option>' : `
                        <option value="正常" ${initialData.status === '正常' ? 'selected' : ''}>正常</option>
                        <option value="異常" ${initialData.status === '異常' ? 'selected' : ''}>異常</option>
                        <option value="待處理" ${initialData.status === '待處理' ? 'selected' : ''}>待處理</option>
                    `}
                </select>
                <label style="display:block; font-weight:bold;">現場照片：</label>
                <input type="file" id="swal-audit-file" accept="image/*" multiple style="display:none;">
                <button type="button" id="swal-btn-upload" class="swal2-confirm swal2-styled" style="background:#6c757d; margin:4px 0 8px 0; padding:6px 12px; font-size:12px;">📷 上傳照片</button>
                <div id="swal-photo-container" class="photo-preview-container">${renderPhotoGrid()}</div>
                <label style="display:block; font-weight:bold;">現場備註：</label>
                <textarea id="swal-audit-memo" class="swal2-textarea" style="width:100%; margin:4px 0 0 0; height:70px;" placeholder="備註說明...">${initialData.memo || ''}</textarea>
            </div>
        `;

        const { isConfirmed } = await Swal.fire({
            title, html: htmlContent, showCancelButton: true, confirmButtonText: '儲存', cancelButtonText: '取消',
            didOpen: () => {
                const fileInput = document.getElementById('swal-audit-file');
                const container = document.getElementById('swal-photo-container');
                document.getElementById('swal-btn-upload').onclick = () => fileInput.click();
                fileInput.onchange = async (e) => {
                    for (const file of Array.from(e.target.files)) {
                        const base64 = await compressImageToBase64(file);
                        tempPhotos.push({ file, preview: base64 });
                    }
                    container.innerHTML = renderPhotoGrid();
                };
                container.onclick = (e) => {
                    if (e.target.classList.contains('btn-remove-photo')) {
                        tempPhotos.splice(parseInt(e.target.dataset.idx, 10), 1);
                        container.innerHTML = renderPhotoGrid();
                    }
                };
            }
        });

        if (isConfirmed) {
            Swal.fire({ title: '同步中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const status = document.getElementById('swal-audit-status').value;
            const memo = document.getElementById('swal-audit-memo').value;
            const existingUrls = tempPhotos.filter(p => p.url && !p.file).map(p => p.url);
            const newFiles = tempPhotos.filter(p => p.file).map(p => p.file);
            const uploadedUrls = await AuditStorage.uploadPhotos(layerName, pointKey, newFiles);

            await onSave({ status, memo, photos: [...existingUrls, ...uploadedUrls], updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            Swal.fire('成功', '紀錄已更新', 'success');
        }
    }

    // 4. API Actions
    window.openAuditEditor = async function (kmlId, featureProps, lat, lng) {
        const layerName = getCleanLayerName(kmlId);
        const pointKey = getPointKey(featureProps);
        const existingData = (window.AuditModule.auditDataStore[layerName] && window.AuditModule.auditDataStore[layerName][pointKey]) || {};

        await openAuditDialog({
            title: `巡檢紀錄 - ${pointKey}`, layerName, pointKey, initialData: existingData, isCustomPoint: false,
            onSave: async (payload) => {
                const db = firebase.firestore();
                await db.collection('audit_records').doc(`${layerName}_${pointKey}`).set({ layerName, pointKey, lat, lng, ...payload }, { merge: true });
                if (!window.AuditModule.auditDataStore[layerName]) window.AuditModule.auditDataStore[layerName] = {};
                window.AuditModule.auditDataStore[layerName][pointKey] = payload;
                if (typeof window.refreshCurrentLayerDisplay === 'function') window.refreshCurrentLayerDisplay();
            }
        });
    };

    window.openAddPointModal = async function (lat, lng) {
        const activeKmlId = window.AuditModule.activeKmlId || document.getElementById('kmlLayerSelect')?.value;
        const layerName = getCleanLayerName(activeKmlId);
        const autoPointKey = `新增點位_${Date.now().toString().slice(-4)}`;

        await openAuditDialog({
            title: "新增自訂點位", layerName, pointKey: autoPointKey, initialData: { status: '新增' }, isCustomPoint: true,
            onSave: async (payload) => {
                const db = firebase.firestore();
                const customGeoJSON = {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [lng, lat] },
                    properties: { auditPointKey: autoPointKey, name: autoPointKey, isCustom: true, layerName, ...payload }
                };
                await db.collection('custom_points').add({ layerName, pointKey: autoPointKey, geoJSON: customGeoJSON, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
                if (!window.AuditModule.customPointsStore[layerName]) window.AuditModule.customPointsStore[layerName] = [];
                window.AuditModule.customPointsStore[layerName].push(customGeoJSON);
                if (typeof window.refreshCurrentLayerDisplay === 'function') window.refreshCurrentLayerDisplay();
            }
        });
    };

    window.deleteCustomPoint = async function (layerName, pointKey) {
        const confirm = await Swal.fire({ title: '確認刪除？', text: `確定要刪除「${pointKey}」嗎？`, icon: 'warning', showCancelButton: true });
        if (confirm.isConfirmed) {
            const db = firebase.firestore();
            const snap = await db.collection('custom_points').where('layerName', '==', layerName).where('pointKey', '==', pointKey).get();
            const batch = db.batch();
            snap.forEach(doc => batch.delete(doc.ref));
            await batch.commit();

            if (window.AuditModule.customPointsStore[layerName]) {
                window.AuditModule.customPointsStore[layerName] = window.AuditModule.customPointsStore[layerName].filter(p => getPointKey(p.properties) !== pointKey);
            }
            Swal.fire('已刪除', '', 'success');
            if (typeof window.refreshCurrentLayerDisplay === 'function') window.refreshCurrentLayerDisplay();
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        window.AuditModule.updateAuditBottomMenuUI();
    });
})(window, document);