/**
 * audit-module.js - 清查模組單一檔案整合版 V3.12
 * 包含：核心同步、地圖渲染、統一編輯彈窗、ZIP打包、CSV報表與自訂點位管理
 */
(function() {
    'use strict';

    // =========================================================
    // 1. 全域變數與權限/工具函式
    // =========================================================
    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = window.globalAuditConfigs || {};
    window.APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    window.STORAGE_ROOT = 'kmldata-d22fb/storage';

    const auditUnsubscribes = {};
    let activeAddPointCleanup = null;

    window.getUserRole = function() {
        return window.currentUserRole || 
               window.userRole || 
               localStorage.getItem('userRole') || 
               sessionStorage.getItem('userRole') || 
               'guest';
    };

    window.checkHasAuditPermission = function() {
        const role = window.getUserRole().toLowerCase().trim();
        return role !== 'guest' && role !== 'unapproved';
    };

    window.canSeeAuditColors = function() {
        const role = window.getUserRole().toLowerCase().trim();
        return ['owner', 'editor', 'user'].includes(role);
    };

    window.escapeHtml = function(str) {
        if (str === null || str === undefined) return '';
        if (typeof str === 'number' || typeof str === 'boolean') return String(str);
        if (typeof str !== 'string') {
            try { return JSON.stringify(str); } catch (e) { return ''; }
        }
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    // =========================================================
    // 2. 地圖圖層 Hook 與渲染引擎
    // =========================================================
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

                if (config && config.isAuditing === true && window.canSeeAuditColors()) {
                    const record = records[pointKey];
                    if (record) {
                        f.properties.auditStatus = record.deviceStatus || "正常";
                        f.properties.auditNote = record.note;
                        f.properties.photos = record.photos || [];
                        f.properties.isAudited = true;
                        f.properties.fillColor = "#FCD770"; 
                        f.properties.radius = 8;
                    } else {
                        f.properties.isAudited = false;
                        f.properties.auditStatus = null;
                        f.properties.fillColor = "#2A00D2"; 
                        f.properties.radius = 8;
                    }
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

    window.forceMapRefresh = function() {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId;
        if (!ns?.map || !kmlId) return;

        const records = window.auditLayersState[kmlId] || {};
        const showAuditMode = window.globalAuditConfigs[kmlId]?.isAuditing && window.canSeeAuditColors();

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
    };

    // =========================================================
    // 3. 清查管理與 ZIP 下載
    // =========================================================
    window.showAuditActionModal = async function() {
        if (!window.checkHasAuditPermission()) {
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
            const safeValue = window.escapeHtml(opt.value);

            listHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid #eee;">
                    <div>
                        <div style="font-weight:bold; font-size:14px;">${window.escapeHtml(baseName)}</div>
                        ${isAuditing ? `<div style="color: #e67e22; font-size:12px;">清查中：需照片 ${targetPhotos} 張</div>` : `<div style="color: #999; font-size: 12px;">未開啟清查</div>`}
                    </div>
                    <div style="display:flex; gap:6px;">
                        ${isAuditing ? `
                            <button onclick="window.downloadAuditPhotosZip('${safeValue}')" style="background:#8e44ad; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:12px;">
                                下載照片
                            </button>
                        ` : ''}
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
        if (!window.checkHasAuditPermission()) return;
        
        try {
            Swal.close(); 
            if (status) {
                const savedOptions = localStorage.getItem('audit_status_options');
                const defaultStatusStr = savedOptions ? JSON.parse(savedOptions).join(', ') : '正常, 損壞, 遺失';

                const { value: formValues } = await Swal.fire({
                    title: '清查模式設定',
                    html: `
                        <div style="text-align:left; font-size:14px;">
                            <div style="margin-bottom: 16px;">
                                <label style="font-weight:bold; display:block; margin-bottom:6px;">1. 設定必填照片張數 (1~12 張)</label>
                                <input id="swal-input-count" type="number" class="swal2-input" value="2" min="1" max="12" step="1" style="width:100%; margin:0; box-sizing:border-box;">
                            </div>
                            <div>
                                <label style="font-weight:bold; display:block; margin-bottom:6px;">2. 設定設備狀態選項 (用逗號或換行分隔)</label>
                                <textarea id="swal-input-status" class="swal2-textarea" style="width:100%; height:80px; margin:0; box-sizing:border-box; resize:vertical;">${defaultStatusStr}</textarea>
                            </div>
                        </div>
                    `,
                    showCancelButton: true,
                    confirmButtonText: '確定並開啟清查',
                    cancelButtonText: '取消',
                    focusConfirm: false,
                    preConfirm: () => {
                        const countVal = parseInt(document.getElementById('swal-input-count').value, 10);
                        const statusVal = document.getElementById('swal-input-status').value.trim();

                        if (!countVal || isNaN(countVal) || countVal < 1 || countVal > 12) {
                            Swal.showValidationMessage('照片張數必須介於 1 到 12 張之間！');
                            return false;
                        }
                        if (!statusVal) {
                            Swal.showValidationMessage('設備狀態選項不能為空！');
                            return false;
                        }

                        const optionsArray = statusVal.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
                        if (optionsArray.length === 0) {
                            Swal.showValidationMessage('請至少輸入一個有效的設備狀態選項！');
                            return false;
                        }

                        return { count: countVal, options: optionsArray };
                    }
                });

                if (formValues) {
                    const { count, options } = formValues;
                    localStorage.setItem('audit_status_options', JSON.stringify(options));
                    Swal.fire({ title: '正在開啟清查...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                    
                    await firebase.firestore().collection(window.APP_PATH).doc(kmlId).set({ 
                        isAuditing: true, 
                        targetPhotos: count,
                        statusOptions: options
                    }, { merge: true });
                    
                    Swal.fire({ icon: 'success', title: '已成功開啟清查模式', timer: 1200, showConfirmButton: false });
                } else {
                    window.showAuditActionModal();
                }
            } else {
                Swal.fire({ title: '正在關閉清查...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                await firebase.firestore().collection(window.APP_PATH).doc(kmlId).set({ isAuditing: false }, { merge: true });
                Swal.fire({ icon: 'success', title: '已關閉清查模式', timer: 1000, showConfirmButton: false });
            }
        } catch (error) {
            console.error("切換清查狀態失敗:", error);
            Swal.fire({ icon: 'error', title: '同步至資料庫失敗', text: error.message }).then(() => window.showAuditActionModal());
        }
    };

    window.downloadAuditPhotosZip = async function(kmlId) {
        if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
            Swal.fire('套件缺失', '請確保已引入 JSZip 與 FileSaver 套件！', 'error');
            return;
        }

        const selectEl = document.getElementById('kmlLayerSelect');
        let kmlLayerName = '';
        if (selectEl) {
            const opt = Array.from(selectEl.options).find(o => o.value === kmlId);
            if (opt) kmlLayerName = (opt.getAttribute('data-basename') || opt.textContent.split(' (')[0]).trim();
        }
        const cleanLayerName = (kmlLayerName || kmlId).replace(/\.kml$/i, '');

        Swal.fire({
            title: '正在搜尋 Storage 照片...',
            html: `<div id="zip-progress-text" style="font-size:14px; margin-top:10px;">請稍候...</div>`,
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const progressEl = document.getElementById('zip-progress-text');

        try {
            const storageFolderPath = `${window.STORAGE_ROOT}/${cleanLayerName}`;
            const folderRef = firebase.storage().ref(storageFolderPath);
            const listResult = await folderRef.listAll();

            if (listResult.items.length === 0) {
                Swal.fire('提示', `Storage 路徑 [${storageFolderPath}] 下找不到任何檔案。`, 'info');
                return;
            }

            const items = listResult.items;
            const zip = new JSZip();
            const rootFolder = zip.folder(cleanLayerName);

            let completedCount = 0;
            let failCount = 0;

            for (let i = 0; i < items.length; i += 3) {
                const batch = items.slice(i, i + 3);
                await Promise.all(batch.map(async (fileRef) => {
                    try {
                        const downloadUrl = await fileRef.getDownloadURL();
                        const response = await fetch(downloadUrl);
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        const blob = await response.blob();
                        rootFolder.file(fileRef.name, blob);
                    } catch (err) {
                        failCount++;
                    } finally {
                        completedCount++;
                        if (progressEl) progressEl.textContent = `打包進度: (${completedCount}/${items.length})`;
                    }
                }));
            }

            if (progressEl) progressEl.textContent = '壓縮 ZIP 中...';
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            saveAs(zipBlob, `${cleanLayerName}_Storage照片總集.zip`);

            Swal.fire({
                icon: failCount > 0 ? 'warning' : 'success',
                title: '打包下載完成！',
                text: `成功打包 ${completedCount - failCount} 個檔案，失敗 ${failCount} 個`,
                timer: 2000,
                showConfirmButton: false
            });
        } catch (error) {
            Swal.fire({ icon: 'error', title: '打包失敗', text: error.message });
        }
    };

    // =========================================================
    // 4. Firebase Storage 照片上傳與 CSV 報表
    // =========================================================
    window.uploadPhotosToStorage = async function(photos, kmlId, pointKey, kmlLayerName) {
        if (!photos || !Array.isArray(photos) || photos.length === 0) return [];
        if (typeof firebase === 'undefined' || typeof firebase.storage !== 'function') {
            throw new Error("Firebase Storage SDK 未載入");
        }

        const rootPath = window.STORAGE_ROOT || 'audit_photos';
        let targetLayerName = kmlLayerName;
        if (!targetLayerName) {
            const selectEl = document.getElementById('kmlLayerSelect');
            const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || window.currentActiveKmlName || '預設區域';
            targetLayerName = rawLayerName.replace(/\.kml$/i, '').trim();
        }

        const storageRef = firebase.storage().ref();
        const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');

        const uploadPromises = photos.map(async (photoData, index) => {
            if (!photoData) return '';
            if (typeof photoData === 'string' && !photoData.startsWith('data:image')) return photoData;

            const photoIndexStr = String(index + 1).padStart(2, '0');
            const customStoragePath = `${rootPath}/${targetLayerName}/${safePointKey}_${photoIndexStr}.jpg`;
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
        });

        return await Promise.all(uploadPromises);
    };

    window.generateLayerCsvReport = async function(kmlId, kmlLayerName, maxPhotos) {
        const activeKmlId = kmlId || window.mapNamespace?.currentKmlLayerId;
        const records = (window.auditLayersState && window.auditLayersState[activeKmlId]) ? window.auditLayersState[activeKmlId] : {};
        const features = window.mapNamespace?.allKmlFeatures || [];

        let headerArr = ["點名", "經度", "緯度", "設備狀態"];
        const photoCount = parseInt(maxPhotos) || 2;
        for (let i = 1; i <= photoCount; i++) headerArr.push(`照片${i}`);
        headerArr.push("備註");
        
        let csvContent = "\uFEFF" + headerArr.join(",") + "\n";
        const allPointKeys = new Set([...Object.keys(records)]);

        features.forEach(f => {
            const key = f.properties?.name || f.properties?.title || f.id;
            if (key) allPointKeys.add(String(key));
        });

        allPointKeys.forEach(pointKey => {
            const record = records[pointKey]; 
            let rowArr = [`"${pointKey.replace(/"/g, '""')}"`, `"${record?.lng || ''}"`, `"${record?.lat || ''}"`];

            if (record) {
                rowArr.push(`"${String(record.deviceStatus || '正常').replace(/"/g, '""')}"`);
                for (let i = 0; i < photoCount; i++) {
                    const url = record.photos && record.photos[i] ? record.photos[i] : "";
                    rowArr.push(`"${url}"`);
                }
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
            const csvStoragePath = `${window.STORAGE_ROOT}/${safeLayerName}/${safeLayerName}_清查總表.csv`;

            const storageRef = firebase.storage().ref().child(csvStoragePath);
            await storageRef.put(blob, { contentType: 'text/csv' });
        } catch (err) {
            console.error("CSV 上傳失敗:", err);
        }
    };

    // =========================================================
    // 5. 統一點位編輯器 (一般點位 & 自訂點位 共用 UI)
    // =========================================================
    window.openUnifiedPointEditor = async function(pointData = {}, isModifyMode = false) {
        if (!window.checkHasAuditPermission()) return;

        // 判斷選取點位與狀態
        const activePoint = window.currentSelectedPoint;
        const layerProps = pointData.props || activePoint?.feature?.properties || activePoint?.properties || {};
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId;
        const pointKey = pointData.name || layerProps.name || layerProps.title || layerProps.id || "未知點位";
        const historyRecord = isModifyMode ? (window.auditLayersState?.[kmlId]?.[pointKey] || {}) : {};

        const isCustomPoint = !!(
            pointData.isCustom || 
            layerProps.isCustom || 
            layerProps.isUserAdded || 
            historyRecord.deviceStatus === '新增'
        );

        // 讀取圖層設定與狀態清單
        const config = window.globalAuditConfigs?.[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos || 2;
        const layerConfig = window.globalAuditConfigs?.[kmlId] || {};
        let statusOptions = layerConfig.statusOptions || ['正常', '損壞', '遺失'];

        const currentStatus = isCustomPoint ? '新增' : (historyRecord.deviceStatus || '');
        const currentNote = historyRecord.note || pointData.remark || '';
        const currentPhotos = new Array(maxPhotos).fill('');
        if (isModifyMode && Array.isArray(historyRecord.photos)) {
            historyRecord.photos.forEach((url, idx) => { if (idx < maxPhotos) currentPhotos[idx] = url || ''; });
        }

        // 動態生成 HTML 內容
        const statusHtml = isCustomPoint ? `
            <div style="margin-bottom:12px;">
                <label style="font-size:14px; font-weight:bold;">設備狀態</label>
                <input type="text" class="swal2-input" value="新增" disabled style="width:100%; margin:6px 0; background:#e9ecef; color:#495057;">
            </div>` : `
            <div style="margin-bottom:12px;">
                <label style="font-size:14px; font-weight:bold;">設備狀態 <span style="color:red;">*必選</span></label>
                <select id="swal-status" class="swal2-input" style="width:100%; margin:6px 0;">
                    <option value="" ${!currentStatus ? 'selected' : ''}>--- 請選擇設備狀態 ---</option>
                    ${statusOptions.map(opt => `<option value="${opt}" ${currentStatus === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                </select>
            </div>`;

        // 圖片預覽與 Client-Side 壓縮
        window._tempPreview = function(input, index) {
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
                        
                        document.getElementById('audit-prev-' + index).src = base64;
                        document.getElementById('audit-prev-' + index).style.display = 'block';
                        document.getElementById('audit-icon-' + index).style.display = 'none';
                        currentPhotos[index] = base64;
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(input.files[0]);
            }
        };

        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const photoData = currentPhotos[i] || '';
            photoHtml += `
                <div style="position:relative;">
                    <div style="border:2px dashed #ccc; height:80px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:6px; overflow:hidden;">
                        <img id="audit-prev-${i}" src="${photoData}" style="width:100%; height:100%; object-fit:cover; display:${photoData ? 'block' : 'none'}; position:absolute; top:0; left:0; z-index:1;">
                        <span id="audit-icon-${i}" style="font-size:22px; color:#bbb; display:${photoData ? 'none' : 'block'}; z-index:1;">📸</span>
                        <input type="file" accept="image/*" capture="environment" onchange="window._tempPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;">
                    </div>
                </div>`;
        }

        // SweetAlert 彈窗設定
        const titleText = isCustomPoint ? `➕ 自訂點位管理：${window.escapeHtml(pointKey)}` : `清查紀錄編輯：${window.escapeHtml(pointKey)}`;
        const { value: res, isDenied } = await Swal.fire({
            title: `<div style="font-size:18px;">${titleText}</div>`,
            html: `<div style="text-align:left;">
                ${statusHtml}
                <label style="font-size:14px; font-weight:bold;">現場照片 (需滿 ${maxPhotos} 張) <span style="color:red;">*必填</span></label>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(90px, 1fr)); gap:8px; margin:6px 0 12px 0;">${photoHtml}</div>
                <label style="font-size:14px; font-weight:bold;">備註事項</label>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%; height:60px; margin:6px 0 0 0;" placeholder="輸入備註...">${window.escapeHtml(currentNote)}</textarea>
            </div>`,
            showCancelButton: true,
            showDenyButton: isCustomPoint,
            denyButtonText: '刪除點位',
            denyButtonColor: '#e74c3c',
            confirmButtonText: isModifyMode ? '覆蓋更新' : '儲存上傳',
            cancelButtonText: '取消',
            preConfirm: () => {
                const statusValue = isCustomPoint ? '新增' : document.getElementById('swal-status')?.value;
                if (!statusValue) { Swal.showValidationMessage('請選擇設備狀態'); return false; }
                const validPhotosCount = currentPhotos.filter(p => p && p.trim() !== '').length;
                if (validPhotosCount < maxPhotos) { Swal.showValidationMessage(`請補滿 ${maxPhotos} 張照片`); return false; }
                return { status: statusValue, note: document.getElementById('swal-note').value, photos: currentPhotos };
            }
        });

        delete window._tempPreview;

        // 執行刪除 (自訂點位專用)
        if (isDenied) {
            if (typeof window.deleteCustomPoint === 'function') {
                await window.deleteCustomPoint(kmlId, pointKey);
            }
            return;
        }

        // 執行寫入與更新
        if (res) {
            Swal.fire({ title: '正在處理中...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const selectEl = document.getElementById('kmlLayerSelect');
                const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '預設區域';
                const kmlLayerName = rawLayerName.replace(/\.kml$/i, '').trim();

                const photoUrls = await window.uploadPhotosToStorage(res.photos, kmlId, pointKey, kmlLayerName);
                const structuredData = {
                    pointName: pointKey,
                    deviceStatus: res.status,
                    note: res.note,
                    photos: photoUrls,
                    isCustomPoint: isCustomPoint,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                if (pointData.lat && pointData.lng) {
                    structuredData.lat = pointData.lat;
                    structuredData.lng = pointData.lng;
                }

                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][pointKey] = structuredData;

                await firebase.firestore().collection(window.APP_PATH).doc(kmlId)
                    .collection('auditRecords').doc(pointKey).set(structuredData, { merge: true });

                if (typeof window.generateLayerCsvReport === 'function') {
                    await window.generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos);
                }

                Swal.fire({ icon: 'success', title: '儲存成功', timer: 1000, showConfirmButton: false });
                if (typeof window.forceMapRefresh === 'function') window.forceMapRefresh();
            } catch (e) {
                Swal.fire('錯誤', e.message || '儲存失敗', 'error');
            }
        }
    };

    // 掛載全域呼叫別名
    window.openAuditEditor = (isModify) => window.openUnifiedPointEditor({}, isModify);

    // =========================================================
    // 6. 地圖點擊新增與點位刪除
    // =========================================================
    window.startAddCustomPoint = function(kmlId) {
        if (!window.checkHasAuditPermission()) {
            Swal.fire('權限不足', '您的帳號角色不允許新增點位！', 'warning');
            return;
        }

        const map = window.mapNamespace?.map;
        if (!map) return;

        if (activeAddPointCleanup) activeAddPointCleanup();
        map.getContainer().style.cursor = 'crosshair';

        Swal.fire({ toast: true, position: 'top', title: '請在地圖上點擊新增點位 (按 ESC 取消)', showConfirmButton: false, timer: 3000 });

        const handleMapClick = async function(e) {
            cleanup();
            const { lat, lng } = e.latlng;
            
            const { value: pointName } = await Swal.fire({
                title: '➕ 新增自訂點位',
                input: 'text',
                inputLabel: '請輸入新點位名稱',
                inputPlaceholder: '例如：新設電桿-01',
                showCancelButton: true,
                cancelButtonText: '取消',
                confirmButtonText: '下一步',
                inputValidator: (value) => {
                    if (!value || !value.trim()) return '點位名稱不能為空！';
                }
            });

            if (pointName) {
                await window.openUnifiedPointEditor({ name: pointName.trim(), lat, lng, isCustom: true }, false);
            }
        };

        const cleanup = () => {
            map.off('click', handleMapClick);
            map.getContainer().style.cursor = '';
            activeAddPointCleanup = null;
        };

        activeAddPointCleanup = cleanup;
        map.on('click', handleMapClick);
    };

    window.deleteCustomPoint = async function(kmlId, pointKey) {
        const confirmRes = await Swal.fire({
            title: '確定刪除點位？',
            text: `將刪除點位「${pointKey}」及其照片！`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '確定刪除',
            cancelButtonText: '取消'
        });

        if (!confirmRes.isConfirmed) return;

        Swal.fire({ title: '正在刪除...', didOpen: () => Swal.showLoading() });
        try {
            await firebase.firestore().collection(window.APP_PATH).doc(kmlId).collection('auditRecords').doc(pointKey).delete();
            if (window.auditLayersState?.[kmlId]?.[pointKey]) delete window.auditLayersState[kmlId][pointKey];

            Swal.fire({ icon: 'success', title: '刪除成功', timer: 1000, showConfirmButton: false });
            if (typeof window.forceMapRefresh === 'function') window.forceMapRefresh();
        } catch (e) {
            Swal.fire('錯誤', e.message || '刪除失敗', 'error');
        }
    };

    // 只讀檢視
    window.viewAuditDetailOnly = function(pointKey) {
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const record = window.auditLayersState[kmlId]?.[pointKey];
        if (!record) return;

        let imagesHtml = '';
        if (Array.isArray(record.photos)) {
            record.photos.forEach(url => {
                if (url) imagesHtml += `<img src="${window.escapeHtml(url)}" style="width:45%; margin:2%; max-height:120px; object-fit:cover; border-radius:6px; border:1px solid #ccc;">`;
            });
        }

        Swal.fire({
            title: `清查紀錄：${window.escapeHtml(pointKey)}`,
            html: `<div style="text-align: left; font-size:14px;">
                <p><b>設備狀況：</b><span style="color:#e91e63; font-weight:bold;">${window.escapeHtml(record.deviceStatus || '正常')}</span></p>
                <p><b>現場備註：</b><br>${window.escapeHtml(record.note || '無備註')}</p>
                <p><b>現場照片：</b></p>
                <div style="display:flex; flex-wrap:wrap;">${imagesHtml || '無照片'}</div>
            </div>`,
            confirmButtonText: '關閉'
        });
    };

    // =========================================================
    // 7. 初始化執行與 UI 按鈕掛載
    // =========================================================
    (function initUIControls() {
        let btn = document.getElementById('btn-standalone-add-point');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'btn-standalone-add-point';
            btn.innerHTML = '➕ 新增點位';
            btn.style.cssText = `
                position: fixed !important; bottom: 20px !important; right: 15px !important;
                z-index: 4000 !important; background-color: #2ecc71 !important; color: #fff !important;
                border: none !important; padding: 8px 20px !important; border-radius: 25px !important;
                font-weight: bold !important; cursor: pointer !important; box-shadow: 0 3px 10px rgba(0,0,0,0.3);
            `;
            btn.onclick = () => window.startAddCustomPoint();
            document.body.appendChild(btn);
        }

        const initListener = () => {
            if (typeof firebase === 'undefined' || !firebase.apps.length) {
                setTimeout(initListener, 500);
                return;
            }
            firebase.firestore().collection(window.APP_PATH).onSnapshot(snapshot => {
                snapshot.forEach(doc => {
                    const data = doc.data();
                    window.globalAuditConfigs[doc.id] = data;
                    if (data.isAuditing && !auditUnsubscribes[doc.id]) {
                        auditUnsubscribes[doc.id] = firebase.firestore().collection(window.APP_PATH).doc(doc.id).collection('auditRecords')
                            .onSnapshot(snap => {
                                const updates = {};
                                snap.forEach(recordDoc => { updates[recordDoc.id] = recordDoc.data(); });
                                window.auditLayersState[doc.id] = updates;
                                if (typeof window.forceMapRefresh === 'function') window.forceMapRefresh();
                            });
                    }
                });
                if (typeof window.forceMapRefresh === 'function') window.forceMapRefresh();
            });
        };
        initListener();
    })();

})();