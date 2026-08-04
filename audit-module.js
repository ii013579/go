/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (全功能無損合併版)
 * 包含：新增/既有點位 CU 合併、批次 ZIP 下載、Firebase Storage 整合與效能增強
 */
(function() {
    'use strict';

    // =========================================================
    // 0. 基礎狀態與全域變數設定
    // =========================================================
    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;
    let clickDebounceTimer = null;
    let activeAddPointCleanup = null;

    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    // =========================================================
    // 0.1 權限防護與安全轉義機制
    // =========================================================
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
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    
    if (typeof window.escapeHtml !== 'function') {
        window.escapeHtml = safeEscape;
    }

    // =========================================================
    // 1. 樣式攔截器與強力重繪機制 (合併新增與既有點位)
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

                if (config && config.isAuditing === true && canSeeAuditColors()) {
                    const record = records[pointKey];
                    if (record) {
                        f.properties.auditStatus = record.deviceStatus || "正常";
                        f.properties.auditNote = record.note;
                        f.properties.photos = record.photos || [];
                        f.properties.isAudited = true;
                        f.properties.fillColor = "#FCD770"; 
                        f.properties.radius = 8;
                        // 若為新增點位，保留自訂標籤
                        if (record.isCustomPoint) f.properties.isCustomPoint = true;
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
                        if (record.isCustomPoint) props.isCustomPoint = true;

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
    // 2. 底部控制按鈕面板 (智慧分流 CU 顯示)
    // =========================================================
    window.createUnifiedAuditButton = function(text, bgColor, onClickHandler) {
        const btn = document.createElement('button');
        btn.innerHTML = text;
        btn.style.cssText = `
            pointer-events: auto; background: ${bgColor}; color: #ffffff; border: none; padding: 10px 22px; 
            border-radius: 25px; font-weight: bold; font-size: 15px; box-shadow: 0 3px 10px rgba(0,0,0,0.25); 
            cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; 
            transition: transform 0.1s ease, box-shadow 0.1s ease; outline: none;
        `;
        btn.onclick = onClickHandler;
        return btn;
    };

    window.updateAuditBottomMenuUI = function(mode, extraData) {
        if (typeof bottomControl === 'undefined' || !bottomControl || !bottomControl._container) return;

        const container = bottomControl._container;
        container.innerHTML = ''; 

        const currentKmlId = window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        if (!currentKmlId || !checkHasAuditPermission() || !canSeeAuditColors()) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '8px';
        container.style.background = 'transparent';

        const props = extraData?.feature?.properties || extraData?.properties || extraData || {};
        const isCustom = !!(props.isCustomPoint || extraData?.isCustomPoint);
        const pointKey = props.auditPointKey || props.name || props.title || "未知點位";
        const safePointKey = safeEscape(pointKey);

        if (mode === 'VIEW_EDIT') {
            // 查看按鈕 (通用)
            container.appendChild(window.createUnifiedAuditButton('查看', '#e91e63', () => {
                if (typeof window.viewAuditDetailOnly === 'function') window.viewAuditDetailOnly(pointKey);
            }));

            // 修改按鈕 (通用，但內部邏輯已支援 CU 合併)
            container.appendChild(window.createUnifiedAuditButton('修改', '#f39c12', () => {
                if (typeof window.openAuditEditor === 'function') window.openAuditEditor(true);
            }));

            // 刪除按鈕 (僅限新增點位 CU)
            if (isCustom) {
                container.appendChild(window.createUnifiedAuditButton('??? 刪除', '#e74c3c', () => {
                    const selectEl = document.getElementById('kmlLayerSelect');
                    const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '預設區域';
                    const layerFolderName = rawLayerName.replace(/\.kml$/i, '').trim();
                    if (typeof window.deleteCustomPoint === 'function') {
                        window.deleteCustomPoint(currentKmlId, pointKey, layerFolderName);
                    }
                }));
            }
        } else if (mode === 'AUDIT_MAIN') {
            container.appendChild(window.createUnifiedAuditButton('清查點位', '#2ecc71', () => {
                if (typeof window.openAuditEditor === 'function') window.openAuditEditor(false);
            }));
        } else {
            container.appendChild(window.createUnifiedAuditButton('? 新增點位', '#2ecc71', () => {
                if (typeof window.startAddCustomPoint === 'function') window.startAddCustomPoint(currentKmlId);
            }));
        }
    };

    window.updateBottomBtnState = function() {
        if (!bottomControl || !bottomControl._container) return;
        const active = window.currentSelectedPoint;
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId];

        if (active && config && config.isAuditing === true) {
            const layerProps = active.feature?.properties || active.properties || {};
            const pointKey = layerProps.name || layerProps.title || layerProps.id || "未知點位";
            const currentRecords = window.auditLayersState[kmlId] || {};
            const isAudited = currentRecords[pointKey] !== undefined;
            
            // 將 active 標記是否為 customPoint 交給 updateAuditBottomMenuUI 渲染
            if (currentRecords[pointKey]?.isCustomPoint) {
                if (active.feature) active.feature.properties.isCustomPoint = true;
                else active.properties.isCustomPoint = true;
            }

            window.updateAuditBottomMenuUI(isAudited ? 'VIEW_EDIT' : 'AUDIT_MAIN', active);
        } else {
            bottomControl._container.style.display = 'none';
        }
    };

    window.addEventListener('click', () => { 
        clearTimeout(clickDebounceTimer);
        clickDebounceTimer = setTimeout(window.updateBottomBtnState, 150); 
    });

    // =========================================================
    // 3. CSV 總表生成
    // =========================================================
    window.generateLayerCsvReport = async function(kmlId, kmlLayerName, maxPhotos) {
        const activeKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        const records = (window.auditLayersState && window.auditLayersState[activeKmlId]) ? window.auditLayersState[activeKmlId] : {};
        const ns = window.mapNamespace;
        const features = ns?.allKmlFeatures || [];

        const getCleanPhotoName = (url) => {
            if (!url) return "";
            try {
                let decoded = decodeURIComponent(String(url)).split("?")[0];
                let fullName = decoded.split("/").pop() || "";
                return fullName.replace(/\.[^/.]+$/, "").replace(/"/g, '""');
            } catch (e) { return String(url).replace(/"/g, '""'); }
        };

        let headerArr = ["點名", "經度", "緯度", "設備狀態"];
        const photoCount = parseInt(maxPhotos) || 2;
        for (let i = 1; i <= photoCount; i++) headerArr.push(`照片${i}`);
        headerArr.push("備註");
        
        let csvContent = "\uFEFF" + headerArr.join(",") + "\n";
        const featureMap = new Map();
        if (Array.isArray(features)) {
            features.forEach(f => {
                const key = f.properties?.name || f.properties?.title || f.id;
                if (key) featureMap.set(String(key), f);
            });
        }

        const allPointKeys = new Set();
        featureMap.forEach((_, key) => allPointKeys.add(key));
        Object.keys(records).forEach(key => { if (key) allPointKeys.add(String(key)); });

        allPointKeys.forEach(pointKey => {
            const record = records[pointKey]; 
            const feature = featureMap.get(pointKey);
            let rowArr = [];
            rowArr.push(`"${pointKey.replace(/"/g, '""')}"`);

            let lng = "", lat = "";
            if (record && record.lng && record.lat) {
                lng = record.lng; lat = record.lat;
            } else if (feature && feature.geometry && feature.geometry.coordinates) {
                const coords = feature.geometry.coordinates;
                lng = coords[0] !== undefined ? coords[0] : "";
                lat = coords[1] !== undefined ? coords[1] : "";
            }
            rowArr.push(`"${lng}"`); rowArr.push(`"${lat}"`);

            if (record) {
                const status = record.deviceStatus || record.status || '正常';
                rowArr.push(`"${String(status).replace(/"/g, '""')}"`);
                for (let i = 0; i < photoCount; i++) {
                    const url = record.photos && record.photos[i] ? record.photos[i] : "";
                    rowArr.push(`"${getCleanPhotoName(url)}"`);
                }
                const note = record.remark || record.note || "";
                rowArr.push(`"${String(note).replace(/"/g, '""')}"`);
            } else {
                rowArr.push('""'); 
                for (let i = 0; i < photoCount; i++) rowArr.push('""');
                rowArr.push('""');
            }
            csvContent += rowArr.join(",") + "\n";
        });

        try {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
            let rootPath = (typeof STORAGE_ROOT !== 'undefined' && STORAGE_ROOT) ? STORAGE_ROOT : 'kmldata-d22fb/storage';
            const safeLayerName = kmlLayerName || 'default_layer';
            const csvStoragePath = `${rootPath.replace(/^\/+|\/+$/g, '')}/${safeLayerName}/${safeLayerName}_清查總表.csv`;
            
            if (typeof firebase === 'undefined' || !firebase.storage) throw new Error("Firebase Storage SDK 未初始化！");
            return await firebase.storage().ref().child(csvStoragePath).put(blob, { contentType: 'text/csv' });
        } catch (err) {
            console.error("CSV上傳失敗", err);
            if (typeof window.downloadCsvFallback === 'function') window.downloadCsvFallback(csvContent, `${kmlLayerName || '清查'}_總表.csv`);
        }
    };

    window.downloadCsvFallback = function(csvData, filename) {
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // =========================================================
    // 4. 清查管理對話框
    // =========================================================
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
            const safeValue = safeEscape(opt.value);

            listHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid #eee;">
                    <div>
                        <div style="font-weight:bold; font-size:14px;">${safeEscape(baseName)}</div>
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
        
        Swal.fire({ title: '圖層清查管理 (v3.06)', html: listHtml, showConfirmButton: false, showCloseButton: true });
    };

    window.toggleAuditStatus = async function(kmlId, status) {
        if (!checkHasAuditPermission()) return;
        try {
            Swal.close(); 
            if (status) {
                const savedOptions = localStorage.getItem('audit_status_options');
                const defaultStatusStr = savedOptions ? JSON.parse(savedOptions).join(', ') : '正常, 損壞, 遺失';

                const { value: formValues } = await Swal.fire({
                    title: '?? 清查模式設定',
                    html: `
                        <div style="text-align:left; font-size:14px;">
                            <div style="margin-bottom: 16px;">
                                <label style="font-weight:bold; display:block; margin-bottom:6px;">設定必填照片張數 (1~12 張)</label>
                                <input id="swal-input-count" type="number" class="swal2-input" value="2" min="1" max="12" style="width:100%; margin:0; box-sizing:border-box;">
                            </div>
                            <div>
                                <label style="font-weight:bold; display:block; margin-bottom:6px;">設定設備狀態選項 (用逗號或換行分隔)</label>
                                <textarea id="swal-input-status" class="swal2-textarea" style="width:100%; height:80px; margin:0; resize:vertical;">${defaultStatusStr}</textarea>
                            </div>
                        </div>`,
                    showCancelButton: true, confirmButtonText: '確定並開啟清查', cancelButtonText: '取消', focusConfirm: false,
                    preConfirm: () => {
                        const countVal = parseInt(document.getElementById('swal-input-count').value, 10);
                        const statusVal = document.getElementById('swal-input-status').value.trim();
                        if (!countVal || countVal < 1 || countVal > 12) { Swal.showValidationMessage('照片張數需介於 1~12'); return false; }
                        const optionsArray = statusVal.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
                        if (optionsArray.length === 0) { Swal.showValidationMessage('請輸入至少一個狀態'); return false; }
                        return { count: countVal, options: optionsArray };
                    }
                });

                if (formValues) {
                    localStorage.setItem('audit_status_options', JSON.stringify(formValues.options));
                    Swal.fire({ title: '開啟中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                    await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: true, targetPhotos: formValues.count, statusOptions: formValues.options }, { merge: true });
                    Swal.fire({ icon: 'success', title: '已成功開啟清查模式', timer: 1200, showConfirmButton: false });
                } else { window.showAuditActionModal(); }
            } else {
                Swal.fire({ title: '關閉中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: false }, { merge: true });
                Swal.fire({ icon: 'success', title: '已關閉清查模式', timer: 1000, showConfirmButton: false });
            }
        } catch (error) {
            Swal.fire({ icon: 'error', title: '同步失敗', text: error.message }).then(() => window.showAuditActionModal());
        }
    };

    // =========================================================
    // 5. 手動新增點位功能 (合併至 CU 管理)
    // =========================================================
    window.startAddCustomPoint = function(kmlId) {
        if (!checkHasAuditPermission()) { Swal.fire('權限不足', '您的帳號角色不允許新增點位！', 'warning'); return; }
        const targetKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        if (!targetKmlId) { Swal.fire('提示', '請先開啟圖層', 'info'); return; }

        const map = window.mapNamespace?.map;
        if (!map) return;
        if (activeAddPointCleanup) activeAddPointCleanup();

        const container = map.getContainer();
        container.style.cursor = 'crosshair';
        Swal.mixin({ toast: true, position: 'top', showConfirmButton: false, timer: 4000, timerProgressBar: true }).fire({ icon: 'info', title: '?? 請在地圖上點擊位置 (按 ESC 取消)' });

        const handleMapClick = async function(e) {
            cleanup();
            await window.openAddPointModal(targetKmlId, e.latlng.lat, e.latlng.lng);
        };
        const handleKeydown = function(e) {
            if (e.key === 'Escape') { cleanup(); Swal.fire({ icon: 'info', title: '已取消', timer: 1000, showConfirmButton: false }); }
        };
        const cleanup = () => {
            map.off('click', handleMapClick);
            document.removeEventListener('keydown', handleKeydown);
            container.style.cursor = '';
            activeAddPointCleanup = null;
        };
        activeAddPointCleanup = cleanup;
        map.on('click', handleMapClick);
        document.addEventListener('keydown', handleKeydown);
    };

    (function renderStandaloneAddButton() {
        let btn = document.getElementById('btn-standalone-add-point');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'btn-standalone-add-point';
            btn.innerHTML = '? 新增點位';
            document.body.appendChild(btn);
        }
        btn.setAttribute('style', `position: fixed !important; bottom: 20px !important; right: 15px !important; z-index: 4000 !important; background-color: #2ecc71 !important; color: #ffffff !important; border: none !important; padding: 8px 20px !important; border-radius: 25px !important; font-weight: bold !important; font-size: 15px !important; box-shadow: 0 3px 10px rgba(0,0,0,0.3) !important; cursor: pointer !important; display: inline-flex !important; align-items: center !important; gap: 6px !important; outline: none !important; white-space: nowrap !important;`);
        btn.onclick = function(e) { e.stopPropagation(); if (typeof window.startAddCustomPoint === 'function') window.startAddCustomPoint(); };
    })();

    window.openAddPointModal = async function(kmlId, lat, lng) {
        const maxPhotos = 2;
        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            photoHtml += `
                <div style="position:relative; margin-bottom:15px; width:80px;">
                    <div style="border:2px dashed #ccc; height:80px; width:80px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:12px; overflow:hidden; cursor:pointer;">
                        <img id="add-prev-${i}" src="" style="width:100%; height:100%; object-fit:cover; display:none; position:absolute; top:0; left:0; z-index:1;">
                        <span id="add-icon-${i}" style="font-size:24px; color:#bbb; z-index:1;">??</span>
                        <input type="file" id="add-photo-input-${i}" accept="image/*" capture="environment" onchange="window.handleAddPhotoPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;">
                    </div>
                </div>`;
        }

        const selectEl = document.getElementById('kmlLayerSelect');
        const kmlLayerName = (selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || kmlId).replace(/\.kml$/i, '').trim();

        const { value: formValues } = await Swal.fire({
            html: `<div style="text-align: left; padding: 0 5px;">
                <div style="text-align: center; font-size: 20px; font-weight: bold; margin-bottom: 20px;">? 新增點位清查紀錄</div>
                <div style="margin-bottom: 16px;"><label>點位名稱 <span style="color:red;">*必填</span></label><input type="text" id="add-point-name" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #ccc;"></div>
                <div style="margin-bottom: 16px;"><label>設備狀態</label><div style="width: 100%; padding: 10px; background-color: #e8f8f5; border-radius: 8px; font-weight: bold; color: #27ae60;">新增</div></div>
                <div style="margin-bottom: 16px;"><label>現場照片 <span style="color:red;">*必填</span></label><div style="display: flex; gap: 15px;">${photoHtml}</div></div>
                <div><label>備註事項</label><textarea id="add-point-remark" style="width: 100%; height: 80px; padding: 10px; border-radius: 8px; border: 1px solid #ccc;"></textarea></div>
            </div>`,
            showCancelButton: true, confirmButtonText: '確認並新增', focusConfirm: false,
            preConfirm: () => {
                const name = document.getElementById('add-point-name').value.trim();
                const f0 = document.getElementById('add-photo-input-0')?.files[0];
                const f1 = document.getElementById('add-photo-input-1')?.files[0];
                if (!name) { Swal.showValidationMessage('請填寫點位名稱！'); return false; }
                if (!f0 || !f1) { Swal.showValidationMessage('請上傳 2 張照片！'); return false; }
                return { kmlId, kmlLayerName, lat, lng, pointKey: name, status: '新增', remark: document.getElementById('add-point-remark').value, photos: [f0, f1] };
            }
        });
        if (formValues) await window.submitNewCustomPoint(formValues);
    };

    window.handleAddPhotoPreview = function(input, index) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = document.getElementById(`add-prev-${index}`);
                const icon = document.getElementById(`add-icon-${index}`);
                if (img) { img.src = e.target.result; img.style.display = 'block'; }
                if (icon) icon.style.display = 'none';
            };
            reader.readAsDataURL(input.files[0]);
        }
    };

    window.submitNewCustomPoint = async function(formValues) {
        const { kmlId, kmlLayerName, lat, lng, pointKey, status, remark, photos } = formValues;
        const trimmedPointKey = pointKey.trim();
        const ns = window.mapNamespace;
        const currentRecords = window.auditLayersState?.[kmlId] || {};
        
        let isDup = !!currentRecords[trimmedPointKey] || (ns?.allKmlFeatures || []).some(f => (f.properties?.name || f.properties?.auditPointKey) === trimmedPointKey);
        if (isDup) {
            Swal.fire({ icon: 'warning', title: '點位名稱重複', text: `名稱「${trimmedPointKey}」已存在！` });
            return;
        }

        Swal.fire({ title: '處理儲存中...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        try {
            const photoUrls = typeof window.uploadPhotosToStorage === 'function' ? await window.uploadPhotosToStorage(photos, kmlId, trimmedPointKey, kmlLayerName) : [];
            const structuredData = { pointName: trimmedPointKey, status: "已完成", deviceStatus: status, note: remark, photos: photoUrls, lat: parseFloat(lat), lng: parseFloat(lng), isCustomPoint: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

            if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
            window.auditLayersState[kmlId][trimmedPointKey] = structuredData;

            const newGeoJsonFeature = { type: "Feature", geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] }, properties: { name: trimmedPointKey, kmlId: kmlId, auditPointKey: trimmedPointKey, isCustomPoint: true, isAudited: true, auditStatus: status, auditNote: remark, photos: photoUrls, fillColor: "#FCD770", radius: 8 } };
            
            if (ns) {
                if (!Array.isArray(ns.allKmlFeatures)) ns.allKmlFeatures = [];
                ns.allKmlFeatures.push(newGeoJsonFeature);
            }

            await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(trimmedPointKey).set(structuredData, { merge: true });
            if (typeof window.generateLayerCsvReport === 'function') await window.generateLayerCsvReport(kmlId, kmlLayerName, 2);

            Swal.fire({ icon: 'success', title: '新增成功', timer: 1200, showConfirmButton: false });
            window.forceMapRefresh();
            setTimeout(window.updateBottomBtnState, 300);
        } catch (e) { Swal.fire('錯誤', e.message, 'error'); }
    };

    // =========================================================
    // 6. 編輯、刪除與照片打包
    // =========================================================
    window.uploadPhotosToStorage = async function(photos, kmlId, pointKey, kmlLayerName) {
        if (!photos || photos.length === 0) return [];
        const storageRef = firebase.storage().ref();
        const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');
        const rootPath = typeof STORAGE_ROOT !== 'undefined' ? STORAGE_ROOT : 'audit_photos';

        return await Promise.all(photos.map(async (photoData, index) => {
            if (!photoData || typeof photoData === 'string' && !photoData.startsWith('data:image')) return photoData || '';
            const path = `${rootPath}/${kmlLayerName}/${safePointKey}_${String(index + 1).padStart(2, '0')}.jpg`;
            const ref = storageRef.child(path);
            let blob = (photoData instanceof File || photoData instanceof Blob) ? photoData : await (await fetch(photoData)).blob();
            await ref.put(blob);
            return await ref.getDownloadURL();
        }));
    };

    window.deleteCustomPoint = async function(kmlId, pointKey, kmlLayerName) {
        const res = await Swal.fire({ title: '確定刪除？', icon: 'warning', showCancelButton: true, confirmButtonText: '刪除' });
        if (!res.isConfirmed) return;
        
        Swal.fire({ title: '刪除中...', didOpen: () => Swal.showLoading() });
        try {
            const rootPath = typeof STORAGE_ROOT !== 'undefined' ? STORAGE_ROOT : 'audit_photos';
            const safeKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');
            await Promise.all([1, 2, 3].map(i => firebase.storage().ref().child(`${rootPath}/${kmlLayerName}/${safeKey}_${String(i).padStart(2, '0')}.jpg`).delete().catch(() => {})));
            await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pointKey).delete();

            if (window.auditLayersState[kmlId]) delete window.auditLayersState[kmlId][pointKey];
            if (window.mapNamespace?.allKmlFeatures) window.mapNamespace.allKmlFeatures = window.mapNamespace.allKmlFeatures.filter(f => f.properties?.auditPointKey !== pointKey);

            window.currentSelectedPoint = null;
            if (typeof window.generateLayerCsvReport === 'function') await window.generateLayerCsvReport(kmlId, kmlLayerName, 2);

            Swal.fire({ icon: 'success', title: '刪除成功', timer: 1200, showConfirmButton: false });
            window.forceMapRefresh();
            setTimeout(window.updateBottomBtnState, 300);
        } catch (e) { Swal.fire('錯誤', e.message, 'error'); }
    };

    window.downloadAuditPhotosZip = async function(kmlId) {
        if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') { Swal.fire('錯誤', '缺 JSZip', 'error'); return; }
        const selectEl = document.getElementById('kmlLayerSelect');
        const kmlLayerName = (selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || kmlId).replace(/\.kml$/i, '').trim();
        
        Swal.fire({ title: '搜尋照片...', html: '<div id="zip-progress-text">請稍候...</div>', didOpen: () => Swal.showLoading() });
        try {
            const folderRef = firebase.storage().ref(`${STORAGE_ROOT}/${kmlLayerName}`);
            const listResult = await folderRef.listAll();
            if (!listResult.items.length) { Swal.fire('提示', '找不到檔案', 'info'); return; }

            const zip = new JSZip(), rootFolder = zip.folder(kmlLayerName);
            let done = 0;
            
            for (let i = 0; i < listResult.items.length; i += 3) {
                await Promise.all(listResult.items.slice(i, i + 3).map(async ref => {
                    try {
                        const url = await ref.getDownloadURL();
                        rootFolder.file(ref.name, await (await fetch(url)).blob());
                    } catch (e) { console.warn('下載失敗', e); }
                    document.getElementById('zip-progress-text').textContent = `進度: ${++done}/${listResult.items.length}`;
                }));
            }
            saveAs(await zip.generateAsync({ type: 'blob' }), `${kmlLayerName}_照片總集.zip`);
            Swal.fire({ icon: 'success', title: '完成！', timer: 2000, showConfirmButton: false });
        } catch (e) { Swal.fire('錯誤', e.message, 'error'); }
    };

    window.viewAuditDetailOnly = function(pointKey) {
        const record = window.auditLayersState[window.mapNamespace?.currentKmlLayerId]?.[pointKey];
        if (!record) return;
        let imagesHtml = (record.photos || []).map(url => url ? `<img src="${safeEscape(url)}" style="width:45%; margin:2%; max-height:120px; object-fit:cover; border-radius:6px; border:1px solid #ccc;">` : '').join('');
        Swal.fire({ title: `清查紀錄：${safeEscape(pointKey)}`, html: `<div style="text-align: left; font-size:14px;"><p><b>設備狀況：</b> ${safeEscape(record.deviceStatus || '正常')}</p><p><b>備註：</b><br>${safeEscape(record.note || '無')}</p><p><b>照片：</b></p><div style="display:flex; flex-wrap:wrap;">${imagesHtml || '無'}</div></div>`, confirmButtonText: '關閉' });
    };

    // =========================================================
    // 7. 初始化與監聽機制
    // =========================================================
    const initGlobalConfigListener = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) return setTimeout(initGlobalConfigListener, 500);
        firebase.firestore().collection(APP_PATH).onSnapshot(snapshot => {
            snapshot.forEach(doc => { 
                window.globalAuditConfigs[doc.id] = doc.data(); 
                if (doc.data().isAuditing) startAuditDataListener(doc.id);
            });
            window.forceMapRefresh();
        });
    };

    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        auditUnsubscribes[kmlId] = firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').onSnapshot(snapshot => {
            const updates = {}; snapshot.forEach(doc => updates[doc.id] = doc.data());
            window.auditLayersState[kmlId] = updates; window.forceMapRefresh();
        });
    }

    let checkAttempts = 0;
    const checkMapInterval = setInterval(() => {
        if (window.mapNamespace?.map && typeof L !== 'undefined') {
            clearInterval(checkMapInterval);
            const AuditMenu = L.Control.extend({
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                    this._container.style.cssText = 'display:none; position:fixed; bottom:35px; left:50%; transform:translateX(-50%); z-index:5000; pointer-events:none; background:transparent; padding:0; gap:12px;';
                    return this._container;
                }
            });
            bottomControl = new AuditMenu();
            bottomControl.addTo(window.mapNamespace.map);
            initGlobalConfigListener();
        } else if (++checkAttempts >= 30) clearInterval(checkMapInterval);
    }, 500);

})();