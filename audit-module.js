/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (v3.25 介面精簡優化版)
 */
(function() {
    'use strict';

    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = {}; 
    window.showAuditedPoints = window.showAuditedPoints ?? true; // 🟡 預設顯示已清查黃點

    const auditUnsubscribes = {};
    let bottomControl = null;
    let yellowDotControl = null;
    let progressControl = null;
    let clickDebounceTimer = null;
    let activeAddPointCleanup = null;

    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    // ---------------------------------------------------------
    // 共用輔助函式 (Helper Utilities)
    // ---------------------------------------------------------
    function getUserRole() {
        return (window.currentUserData?.role || window.currentUserRole || window.userRole || 
                localStorage.getItem('userRole') || sessionStorage.getItem('userRole') || 'guest')
                .toString().trim().toLowerCase();
    }

    function checkHasAuditPermission() {
        const role = getUserRole();
        return role !== 'guest' && role !== 'unapproved';
    }

    function canSeeAuditColors() {
        return ['owner', 'editor', 'user'].includes(getUserRole());
    }

    function safeEscape(str) {
        if (str === null || str === undefined) return '';
        if (typeof str === 'number' || typeof str === 'boolean') return String(str);
        if (typeof str !== 'string') {
            try { return JSON.stringify(str); } catch (e) { return ''; }
        }
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
    window.escapeHtml = safeEscape;

    function getPointKey(props, defaultVal = "未知點位") {
        if (!props) return defaultVal;
        return props.name || props.title || props.auditPointKey || props.id || defaultVal;
    }

    function getLayerFolderName(kmlId, defaultName = '預設區域') {
        const selectEl = document.getElementById('kmlLayerSelect');
        const opt = selectEl ? Array.from(selectEl.options).find(o => o.value === kmlId) : null;
        const rawName = opt ? (opt.getAttribute('data-basename') || opt.textContent.split(' (')[0]) 
                            : (selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || window.currentActiveKmlName || defaultName);
        return rawName.replace(/\.kml$/i, '').trim();
    }

    function setPointAddBtnVisible(visible) {
        const btn = document.getElementById('btn-standalone-add-point');
        if (btn) btn.style.setProperty('display', visible ? 'inline-flex' : 'none', 'important');
    }

    // ---------------------------------------------------------
    // 📊 清查進度與黃點隱藏控制
    // ---------------------------------------------------------
    function getAuditProgress() {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId || window.currentActiveKmlId;
        if (!kmlId) return null;

        const records = window.auditLayersState?.[kmlId] || {};
        const features = ns?.allKmlFeatures || [];

        const pointFeatures = features.filter(f => !f.geometry || f.geometry.type === 'Point');
        const totalCount = pointFeatures.length;

        if (totalCount === 0) return null;

        let auditedCount = 0;
        pointFeatures.forEach(f => {
            const props = f.properties || {};
            const pointKey = getPointKey(props, f.id);
            if (records[pointKey]) {
                auditedCount++;
            }
        });

        const remainingCount = totalCount - auditedCount;

        return {
            audited: auditedCount,
            remaining: remainingCount,
            total: totalCount,
            text: `未清查: ${remainingCount} / ${totalCount}`
        };
    }
    window.getAuditProgress = getAuditProgress;

    window.toggleAuditedPointsVisibility = function() {
        window.showAuditedPoints = !window.showAuditedPoints;
        forceMapRefresh();
        if (typeof updateBottomBtnState === 'function') {
            updateBottomBtnState();
        }
    };

    // ---------------------------------------------------------
    // 0.1 懸浮按鈕顯隱狀態同步 (全域)
    // ---------------------------------------------------------
    function syncAuditButtonVisibility() {
        const kmlId = window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        const config = kmlId ? window.globalAuditConfigs[kmlId] : null;
        setPointAddBtnVisible(checkHasAuditPermission() && !!(config && config.isAuditing));
    }
    window.syncAuditButtonVisibility = syncAuditButtonVisibility;

    // ---------------------------------------------------------
    // 1. 樣式攔截器與強力重繪機制 (含黃點隱藏過濾)
    // ---------------------------------------------------------
    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId || window.currentActiveKmlId;

        if (kmlId && Array.isArray(features)) {
            const config = window.globalAuditConfigs?.[kmlId];
            const records = window.auditLayersState?.[kmlId] || {};
            
            const isAuditingMode = (config?.isAuditing !== undefined) ? config.isAuditing : true;
            const showAudit = isAuditingMode && canSeeAuditColors();
            const isAuditedVisible = window.showAuditedPoints !== false;

            features.forEach(f => {
                if (!f.properties) f.properties = {};
                f.properties.kmlId = kmlId;
                
                const pointKey = f.properties.name || f.properties.title || f.properties.id || f.id || "未知點位";
                f.properties.auditPointKey = pointKey; 

                if (showAudit) {
                    const record = records[pointKey];
                    const isAudited = !!record;
                    f.properties.isAudited = isAudited;

                    if (isAudited) {
                        f.properties.auditStatus = record.deviceStatus || "正常";
                        f.properties.auditNote = record.note;
                        f.properties.photos = record.photos || [];
                        f.properties.fillColor = isAuditedVisible ? "#FCD770" : "transparent"; // 🟡 已清查：黃色
                        
                        f.properties.fillOpacity = isAuditedVisible ? 0.85 : 0;
                        f.properties.opacity = isAuditedVisible ? 1 : 0;
                        f.properties.stroke = isAuditedVisible;
                        f.properties.weight = isAuditedVisible ? 2 : 0;
                    } else {
                        f.properties.auditStatus = null;
                        f.properties.fillColor = "#2A00D2"; // 🔵 未清查：藍色
                        f.properties.fillOpacity = 0.85;
                        f.properties.opacity = 1;
                        f.properties.stroke = true;
                        f.properties.weight = 2;
                    }
                    f.properties.color = isAuditedVisible ? "#ffffff" : "transparent";
                    f.properties.radius = 8;
                } else {
                    f.properties.fillColor = "#e74c3c"; // 🔴 預設紅色
                    f.properties.radius = 8;
                    f.properties.isAudited = false;
                    f.properties.fillOpacity = 0.85;
                    f.properties.opacity = 1;
                    f.properties.stroke = true;
                    f.properties.weight = 1.5;
                    delete f.properties.auditStatus;
                }
            });
        }
        
        const result = originalAddLayers ? originalAddLayers.apply(this, arguments) : null;

        if (ns?.map) {
            const isAuditedVisible = window.showAuditedPoints !== false;
            ns.map.eachLayer(function(layer) {
                const props = layer.feature?.properties || layer.options?.properties;
                if (props && props.isAudited) {
                    if (typeof layer.setStyle === 'function') {
                        layer.setStyle({
                            fillColor: isAuditedVisible ? "#FCD770" : "transparent",
                            fillOpacity: isAuditedVisible ? 0.85 : 0,
                            opacity: isAuditedVisible ? 1 : 0,
                            stroke: isAuditedVisible,
                            weight: isAuditedVisible ? 2 : 0
                        });
                    }
                    if (layer._path) {
                        layer._path.style.display = isAuditedVisible ? '' : 'none';
                        layer._path.style.pointerEvents = isAuditedVisible ? 'auto' : 'none';
                    }
                    if (layer._icon) {
                        layer._icon.style.display = isAuditedVisible ? '' : 'none';
                    }
                }
            });
        }

        return result;
    };

    function forceMapRefresh() {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId || window.currentActiveKmlId;
        if (!ns?.map || !kmlId) return;

        if (window.addGeoJsonLayers && ns.allKmlFeatures) {
            window.addGeoJsonLayers(ns.allKmlFeatures);
        }

        if (typeof syncAuditButtonVisibility === 'function') {
            syncAuditButtonVisibility();
        }
        if (typeof updateBottomBtnState === 'function') {
            updateBottomBtnState();
        }
    }
    window.forceMapRefresh = forceMapRefresh;

    // ---------------------------------------------------------
    // 2. 底部控制按鈕面板與右上角元件 (無文字黃點鈕、進度條在縮放鈕下方)
    // ---------------------------------------------------------
    function updateBottomBtnState() {
        const canAudit = checkHasAuditPermission() && canSeeAuditColors();
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const config = kmlId ? window.globalAuditConfigs[kmlId] : null;
        const isAuditing = config && config.isAuditing === true;

        if (!canAudit || !isAuditing) {
            if (bottomControl?._container) bottomControl._container.style.display = 'none';
            if (yellowDotControl?._container) yellowDotControl._container.style.display = 'none';
            if (progressControl?._container) progressControl._container.style.display = 'none';
            return;
        }

        // 1. 🟡 黃點切換按鈕（無文字，隱藏時帶有 ❌ 標示）
        if (yellowDotControl?._container) {
            const isAuditedVisible = window.showAuditedPoints !== false;
            yellowDotControl._container.style.display = 'block';
            yellowDotControl._container.innerHTML = `
                <button onclick="window.toggleAuditedPointsVisibility()" 
                        title="${isAuditedVisible ? '隱藏已清查黃點' : '顯示已清查黃點'}"
                        style="background: #ffffff; color: #333; border: 2px solid rgba(0,0,0,0.2); width: 34px; height: 34px; border-radius: 4px; font-weight: bold; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 5px rgba(0,0,0,0.4); pointer-events: auto; padding: 0; position: relative;">
                    <span style="display: inline-block; width: 14px; height: 14px; background: #f1c40f; border-radius: 50%; border: 1.5px solid #fff; box-shadow: 0 0 2px rgba(0,0,0,0.3);"></span>
                    ${!isAuditedVisible ? '<span style="position: absolute; color: #e74c3c; font-size: 18px; font-weight: 900; line-height: 1; text-shadow: 0 0 2px #fff;">❌</span>' : ''}
                </button>
            `;
        }

        // 2. 📊 清查進度條（放置於縮放鈕下方，無漏斗圖示）
        if (progressControl?._container) {
            const progress = getAuditProgress();
            if (progress) {
                progressControl._container.style.display = 'block';
                progressControl._container.innerHTML = `
                    <div style="background: rgba(255, 255, 255, 0.95); color: #2c3e50; border: 2px solid rgba(0,0,0,0.2); padding: 5px 10px; border-radius: 4px; font-weight: bold; font-size: 12px; white-space: nowrap; box-shadow: 0 1px 5px rgba(0,0,0,0.4); pointer-events: auto;">
                        未清查: ${progress.remaining} / ${progress.total}
                    </div>
                `;
            } else {
                progressControl._container.style.display = 'none';
            }
        }

        // 3. 🎯 底部清查與編輯按鈕
        if (bottomControl?._container) {
            const active = window.currentSelectedPoint;

            if (active) {
                const layerProps = active.feature?.properties || active.properties || {};
                const pointKey = getPointKey(layerProps);
                const safePointKey = safeEscape(pointKey);
                const isAudited = (window.auditLayersState[kmlId] || {})[pointKey] !== undefined;

                const btnBaseStyle = `color: white; border: none; padding: 6px 16px; border-radius: 50px; font-weight: bold; font-size: 13px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); cursor: pointer; outline: none; line-height: 1.4; white-space: nowrap;`;

                const btnHtml = isAudited ? `
                    <button onclick="window.viewAuditDetailOnly('${safePointKey}')" style="background: #e91e63; ${btnBaseStyle}">🔍 查看</button>
                    <button onclick="window.openAuditEditor(true)" style="background: #f39c12; ${btnBaseStyle}">✏️ 修改</button>
                ` : `
                    <button onclick="window.openAuditEditor(false)" style="background: #2ecc71; ${btnBaseStyle}">📋 清查點位</button>
                `;

                bottomControl._container.style.display = 'block';
                bottomControl._container.innerHTML = `
                    <div style="text-align: center; pointer-events: auto; display: flex; gap: 6px; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); padding: 6px 14px; border-radius: 50px; backdrop-filter: blur(5px); box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
                        ${btnHtml}
                    </div>`;
            } else {
                bottomControl._container.style.display = 'none';
                bottomControl._container.innerHTML = '';
            }
        }
    }

    window.addEventListener('click', () => { 
        clearTimeout(clickDebounceTimer);
        clickDebounceTimer = setTimeout(updateBottomBtnState, 150); 
    });

    // ---------------------------------------------------------
    // 3. CSV 總表生成
    // ---------------------------------------------------------
    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos) {
        const activeKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        const records = (window.auditLayersState && window.auditLayersState[activeKmlId]) || {};
        const features = window.mapNamespace?.allKmlFeatures || [];

        const getCleanPhotoName = (url) => {
            if (!url) return "";
            try {
                let decoded = decodeURIComponent(String(url)).split("?")[0];
                let fileNameOnly = (decoded.split("/").pop() || "").replace(/\.[^/.]+$/, "");
                return fileNameOnly.replace(/"/g, '""');
            } catch (e) {
                return String(url).replace(/"/g, '""');
            }
        };

        const photoCount = parseInt(maxPhotos) || 2;
        let headerArr = ["點名", "經度", "緯度", "設備狀態"];
        for (let i = 1; i <= photoCount; i++) headerArr.push(`照片${i}`);
        headerArr.push("備註");
        
        let csvContent = "\uFEFF" + headerArr.join(",") + "\n";
        const featureMap = new Map();

        if (Array.isArray(features)) {
            features.forEach(f => {
                const key = getPointKey(f.properties, f.id);
                if (key) featureMap.set(String(key), f);
            });
        }

        const allPointKeys = new Set([...featureMap.keys(), ...Object.keys(records)]);

        allPointKeys.forEach(pointKey => {
            if (!pointKey) return;
            const record = records[pointKey]; 
            const feature = featureMap.get(pointKey);
            let rowArr = [`"${pointKey.replace(/"/g, '""')}"`];

            let lng = record?.lng ?? feature?.geometry?.coordinates?.[0] ?? "";
            let lat = record?.lat ?? feature?.geometry?.coordinates?.[1] ?? "";

            rowArr.push(`"${lng}"`, `"${lat}"`);

            if (record) {
                rowArr.push(`"${String(record.deviceStatus || record.status || '正常').replace(/"/g, '""')}"`);
                for (let i = 0; i < photoCount; i++) {
                    rowArr.push(`"${getCleanPhotoName(record.photos?.[i])}"`);
                }
                rowArr.push(`"${String(record.remark || record.note || "").replace(/"/g, '""')}"`);
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
            const csvStoragePath = `${STORAGE_ROOT}/${safeLayerName}/${safeLayerName}_清查總表.csv`;

            if (!firebase?.storage) throw new Error("Firebase Storage SDK 未初始化！");

            return await firebase.storage().ref().child(csvStoragePath).put(blob, { contentType: 'text/csv' });

        } catch (err) {
            if (typeof window.downloadCsvFallback === 'function') {
                window.downloadCsvFallback(csvContent, `${kmlLayerName || '清查'}_總表.csv`);
            }
        }
    }

    window.downloadCsvFallback = function(csvData, filename) {
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // ---------------------------------------------------------
    // 4. 清查管理對話框
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
            const safeValue = safeEscape(opt.value);

            listHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid #eee;">
                    <div>
                        <div style="font-weight:bold; font-size:14px;">${safeEscape(baseName)}</div>
                        ${isAuditing ? `<div style="color: #e67e22; font-size:12px;">清查中：需照片 ${targetPhotos} 張</div>` : `<div style="color: #999; font-size: 12px;">未開啟清查</div>`}
                    </div>
                    <div style="display:flex; gap:6px;">
                        ${isAuditing ? `<button onclick="window.downloadAuditPhotosZip('${safeValue}')" title="下載此圖層所有照片為 ZIP" style="background:#8e44ad; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:12px;">下載照片</button>` : ''}
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
                                <input id="swal-input-count" type="number" class="swal2-input" value="2" min="1" max="12" step="1" style="width:100%; margin:0; box-sizing:border-box;">
                            </div>
                            <div>
                                <label style="font-weight:bold; display:block; margin-bottom:6px;">2. 設定設備狀態選項 (用逗號或換行分隔)</label>
                                <textarea id="swal-input-status" class="swal2-textarea" style="width:100%; height:80px; margin:0; box-sizing:border-box; resize:vertical;">${defaultStatusStr}</textarea>
                            </div>
                        </div>`,
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
                    localStorage.setItem('audit_status_options', JSON.stringify(formValues.options));
                    Swal.fire({ title: '正在開啟清查...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                    
                    await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ 
                        isAuditing: true, 
                        targetPhotos: formValues.count,
                        statusOptions: formValues.options
                    }, { merge: true });
                    
                    if (!window.globalAuditConfigs[kmlId]) window.globalAuditConfigs[kmlId] = {};
                    window.globalAuditConfigs[kmlId].isAuditing = true;

                    syncAuditButtonVisibility();
                    Swal.fire({ icon: 'success', title: '已成功開啟清查模式', timer: 1200, showConfirmButton: false });
                } else {
                    window.showAuditActionModal();
                }
            } else {
                Swal.fire({ title: '正在關閉清查...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: false }, { merge: true });
                
                if (!window.globalAuditConfigs[kmlId]) window.globalAuditConfigs[kmlId] = {};
                window.globalAuditConfigs[kmlId].isAuditing = false;

                syncAuditButtonVisibility();
                Swal.fire({ icon: 'success', title: '已關閉清查模式', timer: 1000, showConfirmButton: false });
            }
        } catch (error) {
            Swal.fire({
                icon: 'error',
                title: '同步至資料庫失敗',
                text: `請檢查網路連線或權限設定。\n(${error.message})`,
                confirmButtonText: '返回管理視窗'
            }).then(() => window.showAuditActionModal());
        }
    };
        
    // =========================================================
    // 5-1. 手動新增點位與地圖點擊
    // =========================================================
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
    
        if (!checkHasAuditPermission()) {
            Swal.fire('權限不足', '您的帳號角色不允許新增點位！', 'warning');
            return;
        }
    
        const targetKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        if (!targetKmlId) {
            Swal.fire('提示', '請先從選單開啟或選擇一個目標圖層再進行新增！', 'info');
            return;
        }
    
        const map = window.mapNamespace?.map;
        if (!map) return;
    
        const container = map.getContainer();
        container.style.cursor = 'crosshair';
        setAddButtonActiveState(true);
    
        Swal.mixin({
            toast: true, position: 'top', showConfirmButton: false, timer: 4000, timerProgressBar: true
        }).fire({ icon: 'info', title: '📍 請在地圖上點擊要新增點位的實體位置' });
    
        const handleMapClick = async function(e) {
            cleanup();
            const { lat, lng } = e.latlng;
            if (typeof window.openAddPointModal === 'function') {
                await window.openAddPointModal(targetKmlId, lat, lng);
            } else if (typeof window.openCustomPointModal === 'function') {
                await window.openCustomPointModal({ isEditMode: false, kmlId: targetKmlId, lat, lng, status: '新增' });
            }
        };
    
        const cleanup = () => {
            map.off('click', handleMapClick);
            container.style.cursor = '';
            activeAddPointCleanup = null;
            setAddButtonActiveState(false);
        };
    
        activeAddPointCleanup = cleanup;
        map.on('click', handleMapClick);
    };
    
    // =========================================================
    // 5-2. 動態渲染獨立「新增點位」按鈕
    // =========================================================
    (function renderStandaloneAddButton() {
        let btn = document.getElementById('btn-standalone-add-point');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'btn-standalone-add-point';
            btn.innerHTML = '➕ 新增點位';
            document.body.appendChild(btn);
        }
    
        btn.setAttribute('style', `
            position: fixed !important; bottom: 20px !important; right: 15px !important; z-index: 4000 !important;
            background-color: #2ecc71 !important; color: #ffffff !important; border: none !important;
            padding: 8px 20px !important; border-radius: 25px !important; font-weight: bold !important; font-size: 15px !important;
            box-shadow: 0 3px 10px rgba(0,0,0,0.3) !important; cursor: pointer !important; display: none !important;
            align-items: center !important; justify-content: center !important; gap: 6px !important; outline: none !important;
            line-height: 1.4 !important; white-space: nowrap !important;
        `);
    
        btn.onclick = function(e) {
            e.stopPropagation();
            if (typeof window.startAddCustomPoint === 'function') window.startAddCustomPoint();
        };
    
        syncAuditButtonVisibility();
    })();
    
    document.addEventListener('change', (e) => {
        if (e.target?.id === 'kmlLayerSelect') {
            setTimeout(syncAuditButtonVisibility, 100);
        }
    });
    
    // =========================================================
    // 5-3. 彈窗 UI 介面與照片預覽
    // =========================================================
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
            kmlId = editData.kmlId; lat = editData.lat; lng = editData.lng; isEditMode = !!editData.isEditMode;
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
                    <div style="border:2px dashed #ccc; height:80px; width:80px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:12px; overflow:hidden; cursor:pointer;">
                        <img id="add-prev-${i}" src="${existingSrc}" style="width:100%; height:100%; object-fit:cover; display:${hasPhoto ? 'block' : 'none'}; position:absolute; top:0; left:0; z-index:1;">
                        <span id="add-icon-${i}" style="font-size:24px; color:#bbb; display:${hasPhoto ? 'none' : 'block'}; z-index:1;">📷</span>
                        <input type="file" id="add-photo-input-${i}" accept="image/*" capture="environment" onchange="window.handleAddPhotoPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;" title="現場拍照">
                    </div>
                    <label for="add-photo-input-${i}" style="position:absolute; left:50%; transform:translateX(-50%); bottom:-10px; z-index:3; background:#555; color:#fff; font-size:11px; padding:2px 8px; border-radius:12px; cursor:pointer; display:flex; align-items:center; gap:4px; box-shadow:0 2px 4px rgba(0,0,0,0.2); white-space:nowrap; border:1px solid #777;">
                        <span>🖼️</span> <span id="add-tag-text-${i}">${hasPhoto ? '已選取' : '圖庫'}</span>
                    </label>
                </div>`;
        }
    
        const kmlLayerName = getLayerFolderName(kmlId);
        const modalTitle = isEditMode ? '修改點位清查紀錄' : '新增點位清查紀錄';
        const confirmBtnText = isEditMode ? '確認並儲存修改' : '確認並新增上傳';
    
        const modalHtml = `
        <div style="text-align: left; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; padding: 0 5px;">
            <div style="text-align: center; font-size: 20px; font-weight: bold; color: #4a4a4a; margin-bottom: 20px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <span style="color: #2ecc71; font-size: 24px; font-weight: 900;">${isEditMode ? '✏️' : '➕'}</span>
                <span>${modalTitle}</span>
            </div>
            <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 15px; font-weight: bold; color: #4a4a4a; margin-bottom: 8px;">點位名稱 / 點名 <span style="color: #e74c3c;">*必填</span></label>
                <input type="text" id="add-point-name" value="${defaultName}" placeholder="例如：新設電桿-01" style="width: 100%; padding: 10px 14px; font-size: 15px; border: 1px solid #dcdfe6; border-radius: 8px; outline: none; box-sizing: border-box; color: #333; background-color: #fff;">
            </div>
            <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 15px; font-weight: bold; color: #4a4a4a; margin-bottom: 8px;">設備狀態</label>
                <select id="add-device-status" disabled style="width: 100%; padding: 10px 14px; font-size: 15px; font-weight: bold; color: #6c757d; background-color: #e9ecef; border: 1px solid #dcdfe6; border-radius: 8px; outline: none; box-sizing: border-box; cursor: not-allowed;">
                    <option value="新增" selected>新增</option>
                </select>
            </div>
            <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 15px; font-weight: bold; color: #4a4a4a; margin-bottom: 8px;">現場照片 (需拍 ${maxPhotos} 張) <span style="color: #e74c3c;">*必填</span></label>
                <div style="display: flex; gap: 15px; flex-wrap: wrap;">${photoHtml}</div>
            </div>
            <div style="margin-bottom: 0px;">
                <label style="display: block; font-size: 15px; font-weight: bold; color: #4a4a4a; margin-bottom: 8px;">備註事項 <span style="color: #909399; font-weight: normal;">(選填)</span></label>
                <textarea id="add-point-remark" placeholder="輸入備註事項..." style="width: 100%; height: 80px; padding: 10px 14px; font-size: 15px; border: 1px solid #dcdfe6; border-radius: 8px; outline: none; box-sizing: border-box; resize: vertical; color: #333; font-family: inherit;">${defaultRemark}</textarea>
            </div>
        </div>`;
    
        const { value: formValues } = await Swal.fire({
            html: modalHtml,
            showCancelButton: true,
            confirmButtonText: confirmBtnText,
            cancelButtonText: '取消',
            confirmButtonColor: '#2ecc71',
            cancelButtonColor: '#707a86',
            buttonsStyling: true,
            customClass: { popup: 'custom-audit-modal-popup', confirmButton: 'custom-audit-confirm-btn', cancelButton: 'custom-audit-cancel-btn' },
            focusConfirm: false,
            didOpen: () => setPointAddBtnVisible(false),
            willClose: () => syncAuditButtonVisibility(),
            preConfirm: () => {
                const name = document.getElementById('add-point-name').value.trim();
                const remark = document.getElementById('add-point-remark').value.trim();
                const photosArray = [];

                for (let i = 0; i < maxPhotos; i++) {
                    const fileInput = document.getElementById(`add-photo-input-${i}`);
                    const img = document.getElementById(`add-prev-${i}`);
                    if (fileInput?.files?.[0]) {
                        photosArray.push(fileInput.files[0]);
                    } else if (img?.src && !img.src.startsWith('data:') && !img.src.startsWith('blob:') && img.src !== window.location.href) {
                        photosArray.push(img.src);
                    }
                }
    
                if (!name) return Swal.showValidationMessage('請填寫點位名稱！');
                if (photosArray.length < maxPhotos) return Swal.showValidationMessage(`請上傳完整 ${maxPhotos} 張現場照片！`);
    
                return {
                    kmlId, kmlLayerName, lat, lng, pointKey: name, name, status: "新增", deviceStatus: "新增",
                    remark, photos: photosArray, isEditMode, oldPointKey: isEditMode ? defaultName : null
                };
            }
        });
    
        if (formValues && typeof window.submitNewCustomPoint === 'function') {
            await window.submitNewCustomPoint(formValues);
            forceMapRefresh();
            syncAuditButtonVisibility();
            setTimeout(updateBottomBtnState, 300);
        }
    };
    
    // =========================================================
    // 5-4. 新增/修改自訂點位送出邏輯
    // =========================================================
    window.submitNewCustomPoint = async function(formValues) {
        const { kmlId, kmlLayerName, lat, lng, pointKey, status, deviceStatus, remark, photos, isEditMode, oldPointKey } = formValues;
        const trimmedPointKey = (pointKey || '').trim();
        const targetDeviceStatus = deviceStatus || status || "新增";
    
        if (!trimmedPointKey) return Swal.fire('提示', '請輸入點位名稱', 'warning');
    
        const numLat = parseFloat(lat), numLng = parseFloat(lng);
        if (isNaN(numLat) || isNaN(numLng)) return Swal.fire('錯誤', '請提供有效的經緯度座標', 'error');
    
        const ns = window.mapNamespace;
        const currentRecords = window.auditLayersState?.[kmlId] || {};
    
        if (!isEditMode || (isEditMode && oldPointKey !== trimmedPointKey)) {
            const isDuplicateInKml = ns?.allKmlFeatures?.some(f => getPointKey(f.properties) === trimmedPointKey);
            const isDuplicateInState = !!currentRecords[trimmedPointKey];
    
            if (isDuplicateInKml || isDuplicateInState) {
                return Swal.fire({
                    icon: 'warning',
                    title: '點位名稱重複',
                    text: `點名「${trimmedPointKey}」已存在！請直接修改點名後重新送出。`,
                    confirmButtonText: '返回修改點名'
                });
            }
        }
    
        Swal.fire({ title: '正在處理並儲存資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
    
        try {
            let photoUrls = (typeof window.uploadPhotosToStorage === 'function')
                ? await window.uploadPhotosToStorage(photos, kmlId, trimmedPointKey, kmlLayerName)
                : (Array.isArray(photos) ? photos.filter(p => typeof p === 'string') : []);
    
            if (isEditMode && oldPointKey && oldPointKey !== trimmedPointKey) {
                if (window.auditLayersState?.[kmlId]) delete window.auditLayersState[kmlId][oldPointKey];
                if (ns?.allKmlFeatures) ns.allKmlFeatures = ns.allKmlFeatures.filter(f => getPointKey(f.properties) !== oldPointKey);
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(oldPointKey).delete();
            }
    
            const structuredData = {
                pointName: trimmedPointKey,
                status: "已完成",
                deviceStatus: targetDeviceStatus,
                auditStatus: targetDeviceStatus,
                note: remark || "",
                photos: photoUrls,
                lat: numLat,
                lng: numLng,
                isCustomPoint: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
    
            if (!window.auditLayersState) window.auditLayersState = {};
            if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
            window.auditLayersState[kmlId][trimmedPointKey] = structuredData;
    
            const newGeoJsonFeature = {
                type: "Feature",
                geometry: { type: "Point", coordinates: [numLng, numLat] },
                properties: {
                    name: trimmedPointKey, title: trimmedPointKey, kmlId, auditPointKey: trimmedPointKey,
                    isCustomPoint: true, isAudited: true, deviceStatus: targetDeviceStatus, auditStatus: targetDeviceStatus,
                    auditNote: remark || "", photos: photoUrls, fillColor: "#FCD770", color: "#ffffff", radius: 8, fillOpacity: 0.85
                }
            };
    
            if (ns) {
                if (!Array.isArray(ns.allKmlFeatures)) ns.allKmlFeatures = [];
                const existingIdx = ns.allKmlFeatures.findIndex(f => getPointKey(f.properties) === trimmedPointKey);
                if (existingIdx >= 0) ns.allKmlFeatures[existingIdx] = newGeoJsonFeature;
                else ns.allKmlFeatures.push(newGeoJsonFeature);
            }
    
            await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(trimmedPointKey).set(structuredData, { merge: true });
    
            if (ns?.allKmlFeatures && typeof window.addGeoJsonLayers === 'function') {
                window.addGeoJsonLayers(ns.allKmlFeatures);
            } else if (typeof forceMapRefresh === 'function') {
                forceMapRefresh();
            }
    
            if (typeof generateLayerCsvReport === 'function') {
                const config = window.globalAuditConfigs?.[kmlId] || {};
                await generateLayerCsvReport(kmlId, kmlLayerName || kmlId || 'default_layer', config.targetPhotos || 2);
            }
    
            Swal.fire({ icon: 'success', title: isEditMode ? '修改點位成功' : '新增清查點位成功', timer: 1200, showConfirmButton: false });
            forceMapRefresh();
            setTimeout(updateBottomBtnState, 300);
    
        } catch (e) {
            Swal.fire('錯誤', e.message || '儲存失敗', 'error');
        }
    };
    
    // =========================================================
    // 5-5. Firebase Storage 照片上傳
    // =========================================================
    window.uploadPhotosToStorage = async function(photos, kmlId, pointKey, kmlLayerName) {
        if (!photos || !Array.isArray(photos) || photos.length === 0) return [];
        if (!firebase?.storage) throw new Error("Firebase Storage SDK 未載入，請確認網頁已引用 firebase-storage.js");

        const targetLayerName = kmlLayerName || getLayerFolderName(kmlId);
        const storageRef = firebase.storage().ref();
        const safePointKey = String(pointKey || 'point').replace(/[/\\?%*:|"<>]/g, '_');

        const uploadPromises = photos.map(async (photoData, index) => {
            if (!photoData) return '';
            if (typeof photoData === 'string' && !photoData.startsWith('data:image')) return photoData;

            const photoIndexStr = String(index + 1).padStart(2, '0');
            const customStoragePath = `${STORAGE_ROOT}/${targetLayerName}/${safePointKey}_${photoIndexStr}.jpg`;
            const ref = storageRef.child(customStoragePath);

            try {
                let blob = photoData;
                if (typeof photoData === 'string' && photoData.startsWith('data:image')) {
                    blob = await (await fetch(photoData)).blob();
                } else if (!(photoData instanceof File || photoData instanceof Blob)) {
                    return photoData;
                }

                await ref.put(blob);
                return await ref.getDownloadURL();
            } catch (uploadError) {
                throw new Error(`照片 ${index + 1} 上傳失敗: ${uploadError.message}`);
            }
        });

        try {
            return await Promise.all(uploadPromises);
        } catch (error) {
            throw error;
        }
    };
    
    window.deleteCustomPoint = async function(kmlId, pointKey, kmlLayerName) {
        if (!kmlId || !pointKey) return Swal.fire('錯誤', '無效的點位資訊，無法刪除', 'error');

        const confirmRes = await Swal.fire({
            title: '確定要刪除此點位？',
            text: `將永久刪除點位「${pointKey}」及其上傳的照片，此動作無法復原！`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: '確定刪除',
            cancelButtonText: '取消'
        });

        if (!confirmRes.isConfirmed) return;

        Swal.fire({ title: '正在刪除點位與照片...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

        try {
            const targetLayerName = kmlLayerName || getLayerFolderName(kmlId);
            const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');
            const storageRef = firebase.storage().ref();

            await Promise.all([1, 2, 3].map(async (i) => {
                const photoIndexStr = String(i).padStart(2, '0');
                try {
                    await storageRef.child(`${STORAGE_ROOT}/${targetLayerName}/${safePointKey}_${photoIndexStr}.jpg`).delete();
                } catch (err) {}
            }));

            await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pointKey).delete();

            if (window.auditLayersState?.[kmlId]) delete window.auditLayersState[kmlId][pointKey];

            const ns = window.mapNamespace;
            if (ns?.allKmlFeatures) {
                ns.allKmlFeatures = ns.allKmlFeatures.filter(f => getPointKey(f.properties) !== pointKey);
            }

            window.currentSelectedPoint = null;
            if (typeof generateLayerCsvReport === 'function') {
                await generateLayerCsvReport(kmlId, targetLayerName, 2);
            }

            Swal.fire({ icon: 'success', title: '已順利刪除點位', timer: 1200, showConfirmButton: false });
            forceMapRefresh();
            setTimeout(updateBottomBtnState, 300);

        } catch (e) {
            Swal.fire('錯誤', e.message || '刪除失敗', 'error');
        }
    };
    
    // =========================================================
    // 5-6. 清查資料編輯與修改
    // =========================================================
    window.openAuditEditor = async function(isModifyMode = false) {
        if (!checkHasAuditPermission()) return;
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) return;

        const layerProps = activePoint.feature?.properties || activePoint.properties || {};
        const pointKey = getPointKey(layerProps);
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs?.[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos || 2;
        const kmlLayerName = getLayerFolderName(kmlId);
        const historyRecord = isModifyMode ? (window.auditLayersState?.[kmlId]?.[pointKey] || {}) : {};

        const isUserCreatedPoint = !!(
            layerProps.isCustom || layerProps.isNew || layerProps.isUserAdded || layerProps.createdByUser ||
            kmlId === 'custom_points' || historyRecord.deviceStatus === '新增' || layerProps.deviceStatus === '新增'
        );

        const currentPhotos = new Array(maxPhotos).fill('');
        if (isModifyMode && Array.isArray(historyRecord.photos)) {
            historyRecord.photos.forEach((url, idx) => { if (idx < maxPhotos) currentPhotos[idx] = url || ''; });
        }

        const currentStatus = isUserCreatedPoint ? '新增' : (historyRecord.deviceStatus || '');
        const currentNote = historyRecord.note || '';
        const baseStatusOptions = window.globalAuditConfigs?.[kmlId]?.statusOptions || 
                                  (localStorage.getItem('audit_status_options') ? JSON.parse(localStorage.getItem('audit_status_options')) : ['正常','損壞','遺失']);

        let statusSelectHtml = isUserCreatedPoint ? `
            <select id="swal-status" class="swal2-input" disabled style="width:100%; margin:6px 0 16px 0; background-color:#e9ecef; color:#495057; cursor:not-allowed;">
                <option value="新增" selected>新增</option>
            </select>` : `
            <select id="swal-status" class="swal2-input" style="width:100%; margin:6px 0 16px 0;">
                <option value="" ${!currentStatus ? 'selected' : ''}>--- 請選擇設備狀態 ---</option>
                ${baseStatusOptions.filter(opt => opt !== '新增').map(opt => `<option value="${opt}" ${currentStatus === opt ? 'selected' : ''}>${opt}</option>`).join('')}
            </select>`;

        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const photoData = currentPhotos[i] || '';
            const isUrl = photoData.startsWith('http');
            
            photoHtml += `
                <div style="position:relative; margin-bottom:18px;">
                    <div style="border:2px dashed #ccc; height:85px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:8px; overflow:hidden;">
                        <img id="audit-prev-${i}" src="${photoData}" style="width:100%; height:100%; object-fit:cover; display:${photoData ? 'block' : 'none'}; position:absolute; top:0; left:0; z-index:1;">
                        <span id="audit-icon-${i}" style="font-size:24px; color:#bbb; display:${photoData ? 'none' : 'block'}; z-index:1;">📷</span>
                        <input type="file" id="audit-file-input-${i}" data-index="${i}" accept="image/*" capture="environment" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;" title="直接拍照">
                    </div>
                    <input type="file" id="audit-gallery-input-${i}" data-index="${i}" accept="image/*" style="display:none;">
                    <label for="audit-gallery-input-${i}" id="audit-tag-${i}" style="position:absolute; left:50%; transform:translateX(-50%); bottom:-10px; z-index:3; background:#444; color:#fff; font-size:11px; padding:2px 8px; border-radius:10px; display:flex; align-items:center; gap:3px; white-space:nowrap; cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.2);">
                        ${isUrl ? '<span>🖼️</span> 舊照片' : (photoData ? '<span>🖼️</span> 新選擇' : '<span>📁</span> 開啟舊檔')}
                    </label>
                </div>`;
        }

        const { value: res, isDenied } = await Swal.fire({
            title: `<div style="font-size:18px;">${isModifyMode ? '修改' : '填寫'}清查紀錄：${safeEscape(pointKey)}</div>`,
            html: `<div style="text-align:left;">
                <label style="font-size:14px; font-weight:bold;">設備狀態 <span style="color:red;">*必選</span></label>
                ${statusSelectHtml}
                <label style="font-size:14px; font-weight:bold;">現場照片 (需滿 ${maxPhotos} 張) <span style="color:red;">*必填</span></label>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(95px, 1fr)); gap:10px; margin:8px 0 16px 0;">${photoHtml}</div>
                <label style="font-size:14px; font-weight:bold;">備註事項 <span style="color:#888; font-weight:normal;">(選填)</span></label>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%; height:70px; margin:6px 0 0 0; resize:vertical;" placeholder="輸入備註事項...">${safeEscape(currentNote)}</textarea>
            </div>`,
            showCancelButton: true,
            showDenyButton: isUserCreatedPoint,
            denyButtonText: '🗑️ 刪除點位',
            denyButtonColor: '#e74c3c',
            confirmButtonText: isModifyMode ? '覆蓋更新' : '確認並上傳',
            cancelButtonText: '取消',
            didOpen: (modalEl) => {
                setPointAddBtnVisible(false);

                const handlePhotoChange = (inputEl, index) => {
                    if (inputEl.files?.[0]) {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            const img = new Image();
                            img.onload = () => {
                                const canvas = document.createElement('canvas');
                                let width = img.width, height = img.height, max_size = 1920;
                                if (width > height) { if (width > max_size) { height *= max_size / width; width = max_size; } } 
                                else { if (height > max_size) { width *= max_size / height; height = max_size; } }
                                canvas.width = width; canvas.height = height;
                                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                                const base64 = canvas.toDataURL('image/jpeg', 0.82);
                                
                                const prevEl = document.getElementById('audit-prev-' + index);
                                const iconEl = document.getElementById('audit-icon-' + index);
                                const tagEl = document.getElementById('audit-tag-' + index);

                                if (prevEl) { prevEl.src = base64; prevEl.style.display = 'block'; }
                                if (iconEl) iconEl.style.display = 'none';
                                if (tagEl) tagEl.innerHTML = '<span>🖼️</span> 新選擇';

                                currentPhotos[index] = base64;
                            };
                            img.src = e.target.result;
                        };
                        reader.readAsDataURL(inputEl.files[0]);
                    }
                };

                for (let i = 0; i < maxPhotos; i++) {
                    const cameraInput = modalEl.querySelector(`#audit-file-input-${i}`);
                    const galleryInput = modalEl.querySelector(`#audit-gallery-input-${i}`);
                    if (cameraInput) cameraInput.onchange = (e) => handlePhotoChange(e.target, i);
                    if (galleryInput) galleryInput.onchange = (e) => handlePhotoChange(e.target, i);
                }
            },
            willClose: () => syncAuditButtonVisibility(),
            preConfirm: () => {
                const statusValue = document.getElementById('swal-status').value;
                if (!statusValue) return Swal.showValidationMessage('請選擇設備狀態'); 
                
                const validPhotosCount = currentPhotos.filter(p => p && p.trim() !== '').length;
                if (validPhotosCount < maxPhotos) return Swal.showValidationMessage(`請補滿 ${maxPhotos} 張照片 (目前 ${validPhotosCount}/${maxPhotos})`); 
                
                return { status: statusValue, note: document.getElementById('swal-note').value, photos: currentPhotos };
            }
        });

        if (isDenied) {
            if (typeof window.deleteCustomPoint === 'function') {
                await window.deleteCustomPoint(kmlId, pointKey, kmlLayerName);
            }
            return;
        }

        if (res) {
            Swal.fire({ title: '正在上傳與更新資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const photoUrls = await window.uploadPhotosToStorage(res.photos, kmlId, pointKey, kmlLayerName);

                const structuredData = {
                    pointName: pointKey, status: "已完成", deviceStatus: res.status, 
                    note: res.note, photos: photoUrls, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                if (!window.auditLayersState) window.auditLayersState = {};
                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][pointKey] = structuredData;

                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pointKey).set(structuredData, { merge: true });

                if (typeof generateLayerCsvReport === 'function') await generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos);

                Swal.fire({ icon: 'success', title: '更新成功', timer: 1000, showConfirmButton: false });
                forceMapRefresh();
                setTimeout(updateBottomBtnState, 300);
            } catch (e) { 
                Swal.fire('錯誤', e.message || '儲存失敗', 'error'); 
            }
        }
    };
      
    // ---------------------------------------------------------
    // 7. 查看詳細紀錄彈窗
    // ---------------------------------------------------------
    window.viewAuditDetailOnly = function(pointKey) {
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const record = window.auditLayersState[kmlId]?.[pointKey];
        if (!record) return;

        let imagesHtml = '';
        if (Array.isArray(record.photos)) {
            record.photos.forEach(url => {
                if (url) imagesHtml += `<img src="${safeEscape(url)}" style="width:45%; margin:2%; max-height:120px; object-fit:cover; border-radius:6px; border:1px solid #ccc;">`;
            });
        }

        Swal.fire({
            title: `清查紀錄：${safeEscape(pointKey)}`,
            html: `<div style="text-align: left; font-size:14px;">
                <p><b>設備狀況：</b><span style="color:#e91e63; font-weight:bold;">🟢 ${safeEscape(record.deviceStatus || '正常')}</span></p>
                <p><b>現場備註：</b><br>${safeEscape(record.note || '無備註')}</p>
                <p><b>現場照片：</b></p>
                <div style="display:flex; flex-wrap:wrap;">${imagesHtml || '無照片'}</div>
            </div>`,
            confirmButtonText: '關閉'
        });
    };

    // ---------------------------------------------------------
    // 8. 打包 Firebase Storage 照片
    // ---------------------------------------------------------
    window.downloadAuditPhotosZip = async function(kmlId) {
        if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
            return Swal.fire('套件缺失', '請確保 HTML 已引入 JSZip 與 FileSaver 套件！', 'error');
        }

        if (!['owner', 'editor'].includes(getUserRole())) {
            return Swal.fire('權限不足', '只有 Editor 或 Owner 角色才能打包下載清查照片！', 'warning');
        }
    
        const cleanLayerName = getLayerFolderName(kmlId, kmlId);

        Swal.fire({
            title: '正在搜尋 Storage 照片...',
            html: `<div id="zip-progress-text" style="font-size:14px; margin-top:10px;">請稍候...</div>`,
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const progressEl = document.getElementById('zip-progress-text');

        try {
            const storageFolderPath = `${STORAGE_ROOT}/${cleanLayerName}`;
            const listResult = await firebase.storage().ref(storageFolderPath).listAll();

            if (listResult.items.length === 0) {
                return Swal.fire('提示', `Storage 路徑 [${storageFolderPath}] 下找不到任何檔案。`, 'info');
            }

            const items = listResult.items;
            if (progressEl) progressEl.textContent = `找到 ${items.length} 個檔案，準備下載...`;

            const zip = new JSZip();
            const rootFolder = zip.folder(cleanLayerName);
            let completedCount = 0, failCount = 0;

            const BATCH_SIZE = 3;
            for (let i = 0; i < items.length; i += BATCH_SIZE) {
                const batch = items.slice(i, i + BATCH_SIZE);

                await Promise.all(batch.map(async (fileRef) => {
                    try {
                        const downloadUrl = await fileRef.getDownloadURL();
                        const response = await fetch(downloadUrl);
                        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                        rootFolder.file(fileRef.name, await response.blob());
                    } catch (err) {
                        failCount++;
                    } finally {
                        completedCount++;
                        if (progressEl) progressEl.textContent = `打包進度: (${completedCount}/${items.length})`;
                    }
                }));
            }

            if (completedCount - failCount === 0) throw new Error('所有檔案下載皆失敗，請確認網路連線或 CORS 設定。');
            if (progressEl) progressEl.textContent = '檔案下載完成，正在壓縮 ZIP...';

            saveAs(await zip.generateAsync({ type: 'blob' }), `${cleanLayerName}_Storage照片總集.zip`);

            Swal.fire({
                icon: failCount > 0 ? 'warning' : 'success',
                title: '打包下載完成！',
                text: failCount > 0 ? `成功打包 ${completedCount - failCount} 個檔案，失敗 ${failCount} 個` : `已成功下載 ${completedCount} 個檔案與 CSV 清冊`,
                timer: 2500,
                showConfirmButton: false
            });

        } catch (error) {
            Swal.fire({ icon: 'error', title: '打包失敗', text: error.message || '發生未知錯誤' });
        }
    };
        
    // ---------------------------------------------------------
    // 9. 資料動態監聽與安全退場機制
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
                if (data.isAuditing) startAuditDataListener(doc.id);
            });
            updateKmlSelectUI();
            forceMapRefresh();
        }, err => {});
    };

    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        auditUnsubscribes[kmlId] = firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snapshot => {
                const updates = {};
                snapshot.forEach(doc => updates[doc.id] = doc.data());
                window.auditLayersState[kmlId] = updates;
                forceMapRefresh(); 
            }, err => {});
    }

    window.cleanupAuditListeners = function() {
        Object.keys(auditUnsubscribes).forEach(key => {
            if (typeof auditUnsubscribes[key] === 'function') {
                auditUnsubscribes[key]();
                delete auditUnsubscribes[key];
            }
        });
    };

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

    // ---------------------------------------------------------
    // 10. Leaflet 地圖初始化掛載 (破圖修復機制)
    // ---------------------------------------------------------
    let checkAttempts = 0;
    const checkMapInterval = setInterval(() => {
        checkAttempts++;
        if (window.mapNamespace?.map && typeof L !== 'undefined') {
            clearInterval(checkMapInterval);
            
            const map = window.mapNamespace.map;
            map.on('moveend zoomend resize', () => {
                setTimeout(() => map.invalidateSize({ animate: false }), 100);
            });

            map.eachLayer(layer => {
                if (layer instanceof L.TileLayer) {
                    layer.options.keepBuffer = 4;
                    layer.options.updateWhenIdle = false;
                }
            });

            // 1. 底部選單 Control
            const AuditMenu = L.Control.extend({
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                    this._container.style.cssText = 'display:none; position:fixed; bottom:35px; left:50%; transform:translateX(-50%); z-index:5000; pointer-events:none; background:transparent; padding:0; box-shadow:none; gap:12px;';
                    return this._container;
                }
            });
            bottomControl = new AuditMenu();
            bottomControl.addTo(map);

            // 2. 🟡 黃點隱藏/顯示開關 Control (右上角)
            const YellowDotControl = L.Control.extend({
                options: { position: 'topright' },
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'leaflet-control-yellow-dot');
                    this._container.style.cssText = 'margin-top:10px; margin-right:10px; z-index:1000;';
                    return this._container;
                }
            });
            yellowDotControl = new YellowDotControl();
            yellowDotControl.addTo(map);

            // 3. 📊 清查進度條 Control (放置於地圖縮放鈕左側)
            const ProgressControl = L.Control.extend({
                options: { position: 'topright' },
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'leaflet-control-audit-progress');
                    this._container.style.cssText = 'margin-top: 15px; margin-right: 0px;; z-index: 1000;';
                    return this._container;
                }
            });
            progressControl = new ProgressControl();
            progressControl.addTo(map);
            
            initGlobalConfigListener();
        } else if (checkAttempts >= 30) {
            clearInterval(checkMapInterval);
        }
    }, 500);

})();
