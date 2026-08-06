/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (v3.07 效能與結構優化版)
 */
(function() {
    'use strict';

    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;
    let clickDebounceTimer = null;
    let activeAddPointCleanup = null;

    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    // ---------------------------------------------------------
    // 0. 通用工具與路徑管理函式
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

    function getCleanLayerName(kmlId, kmlLayerName) {
        let target = kmlLayerName || kmlId;
        if (!target) {
            const selectEl = document.getElementById('kmlLayerSelect');
            target = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') 
                || window.currentActiveKmlName 
                || window.mapNamespace?.currentKmlLayerId 
                || '預設區域';
        }
        return String(target).replace(/\.kml$/i, '').trim();
    }
    window.getStorageLayerFolder = getCleanLayerName;

    function buildStoragePath(layerName, fileName) {
        const root = (STORAGE_ROOT || 'kmldata-d22fb/storage').replace(/^\/+|\/+$/g, '');
        const folder = (layerName || 'default_layer').replace(/^\/+|\/+$/g, '');
        return `${root}/${folder}/${fileName}`;
    }

    // ---------------------------------------------------------
    // 0.1 懸浮按鈕顯隱狀態同步
    // ---------------------------------------------------------
    function syncAuditButtonVisibility() {
        const btn = document.getElementById('btn-standalone-add-point');
        if (!btn) return;

        const kmlId = window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        const config = kmlId ? window.globalAuditConfigs[kmlId] : null;

        const hasPermission = checkHasAuditPermission();
        const isAuditing = !!(config && config.isAuditing === true);

        if (hasPermission && isAuditing) {
            btn.style.setProperty('display', 'inline-flex', 'important');
        } else {
            btn.style.setProperty('display', 'none', 'important');
        }
    }
    window.syncAuditButtonVisibility = syncAuditButtonVisibility;

    // ---------------------------------------------------------
    // 1. 樣式算式與常量 (防錯 key 比對)
    // ---------------------------------------------------------
    const BASE_STYLE = { color: "#ffffff", fillOpacity: 0.85, radius: 8 };

    // 色彩規則：未開啟清查為紅色(#e74c3c)；開啟清查後，已清查為黃色(#FCD770)，未清查為藍色(#2A00D2)
    function getPointStyle(isAuditMode, hasRecord) {
        if (!isAuditMode) {
            return { ...BASE_STYLE, fillColor: "#e74c3c", weight: 1.5 };
        }
        return {
            ...BASE_STYLE,
            fillColor: hasRecord ? "#FCD770" : "#2A00D2",
            weight: 2
        };
    }

    // 安全檢查是否有紀錄 (強轉字串比對，解決型態不符問題)
    function checkHasRecord(records, pointKey, props) {
        if (!records) return false;
        const strKey = String(pointKey);
        const altKey = String(props?.id || props?.name || props?.title || '');
        return Boolean(records[strKey] || (altKey && records[altKey]));
    }

    // ---------------------------------------------------------
    // 2. 樣式攔截器
    // ---------------------------------------------------------
    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId;

        if (kmlId && Array.isArray(features)) {
            const config = window.globalAuditConfigs?.[kmlId];
            const records = window.auditLayersState?.[kmlId] || {};
            const isAuditMode = Boolean(config?.isAuditing === true && canSeeAuditColors());

            features.forEach(f => {
                if (!f.properties) f.properties = {};
                f.properties.kmlId = kmlId;
                
                const pointKey = f.properties.name || f.properties.title || f.properties.id || f.id || "未知點位";
                f.properties.auditPointKey = pointKey;

                const hasRecord = isAuditMode ? checkHasRecord(records, pointKey, f.properties) : false;
                const record = hasRecord ? (records[String(pointKey)] || records[pointKey]) : null;
                const style = getPointStyle(isAuditMode, hasRecord);

                // 💡 強制同步寫入 feature.properties，確保 Leaflet 點擊事件能讀取正確色彩
                Object.assign(f.properties, style, {
                    isAudited: hasRecord,
                    auditStatus: record ? (record.deviceStatus || "正常") : null,
                    auditNote: record?.note,
                    photos: record?.photos || []
                });

                if (!isAuditMode) delete f.properties.auditStatus;
            });
        }
        if (originalAddLayers) return originalAddLayers.apply(this, arguments);
    };

    // ---------------------------------------------------------
    // 3. 強力重繪機制 (同步修復 Click 與 style)
    // ---------------------------------------------------------
    function forceMapRefresh() {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId;
        if (!ns?.map || !kmlId) return;

        const records = window.auditLayersState?.[kmlId] || {};
        const isAuditMode = Boolean(window.globalAuditConfigs?.[kmlId]?.isAuditing && canSeeAuditColors());

        ns.map.eachLayer(layer => {
            const props = layer.feature?.properties;
            if (!props) return;

            const pointKey = props.name || props.title || props.id || props.auditPointKey || "未知點位";
            const isCustomPoint = props.isCustomPoint || props.auditStatus === "新增" || props.status === "新增" || String(pointKey).startsWith("NEW_");

            if (isCustomPoint && !checkHasRecord(records, pointKey, props)) {
                ns.map.removeLayer(layer);
                return;
            }

            const hasRecord = isAuditMode ? checkHasRecord(records, pointKey, props) : false;
            const record = hasRecord ? (records[String(pointKey)] || records[pointKey]) : null;
            const style = getPointStyle(isAuditMode, hasRecord);

            // 💡 關鍵：更新 properties 的同時，直接重新寫入 feature.properties
            Object.assign(props, style, {
                isAudited: hasRecord,
                auditStatus: record ? (record.deviceStatus || record.status || "正常") : props.auditStatus,
                photos: record?.photos || props.photos || [],
                auditNote: record ? (record.note || record.remark) : props.auditNote
            });

            if (typeof layer.setStyle === 'function') {
                layer.setStyle(style);
            }
        });

        syncAuditButtonVisibility();
    }
    window.forceMapRefresh = forceMapRefresh;

    // ---------------------------------------------------------
    // 2. 底部控制按鈕面板
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
            
            const currentRecords = window.auditLayersState[kmlId] || {};
            const isAudited = currentRecords[pointKey] !== undefined;

            const btnBaseStyle = `
                color: white; 
                border: none; 
                padding: 8px 20px; 
                border-radius: 25px; 
                font-weight: bold; 
                font-size: 15px; 
                box-shadow: 0 3px 10px rgba(0,0,0,0.3); 
                cursor: pointer;
                outline: none;
                line-height: 1.4;
            `;

            let btnHtml = isAudited ? `
                <button onclick="window.viewAuditDetailOnly('${safePointKey}')" style="background: #e91e63; ${btnBaseStyle}">查看</button>
                <button onclick="window.openAuditEditor(true)" style="background: #f39c12; ${btnBaseStyle}">修改</button>
            ` : `
                <button onclick="window.openAuditEditor(false)" style="background: #2ecc71; ${btnBaseStyle}">清查點位</button>
            `;

            bottomControl._container.style.display = 'block';
            bottomControl._container.innerHTML = `
                <div style="text-align: center; pointer-events: auto; display: flex; gap: 10px; justify-content: center; background: transparent; padding: 0;">
                    ${btnHtml}
                </div>`;
        } else {
            bottomControl._container.style.display = 'none';
        }
    }

    window.addEventListener('click', () => { 
        clearTimeout(clickDebounceTimer);
        clickDebounceTimer = setTimeout(updateBottomBtnState, 150); 
    });

    // ---------------------------------------------------------
    // 3. CSV 總表生成 (路徑優化)
    // ---------------------------------------------------------
    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos) {
        const activeKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        const records = (window.auditLayersState && window.auditLayersState[activeKmlId]) ? window.auditLayersState[activeKmlId] : {};
        const ns = window.mapNamespace;
        const features = ns?.allKmlFeatures || [];

        const getCleanPhotoName = (url) => {
            if (!url) return "";
            try {
                let decoded = decodeURIComponent(String(url)).split("?")[0];
                let fullName = decoded.split("/").pop() || "";
                let fileNameOnly = fullName.replace(/\.[^/.]+$/, "");
                return fileNameOnly.replace(/"/g, '""');
            } catch (e) {
                return String(url).replace(/"/g, '""');
            }
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

        const allPointKeys = new Set([...featureMap.keys(), ...Object.keys(records).map(String)]);

        allPointKeys.forEach(pointKey => {
            const record = records[pointKey]; 
            const feature = featureMap.get(pointKey);
            let rowArr = [`"${pointKey.replace(/"/g, '""')}"`];
            
            let lng = "", lat = "";
            if (record && record.lng && record.lat) {
                lng = record.lng; lat = record.lat;
            } else if (feature?.geometry?.coordinates) {
                lng = feature.geometry.coordinates[0] ?? "";
                lat = feature.geometry.coordinates[1] ?? "";
            }

            rowArr.push(`"${lng}"`, `"${lat}"`);

            if (record) {
                const status = record.deviceStatus || record.status || '正常';
                rowArr.push(`"${String(status).replace(/"/g, '""')}"`);

                for (let i = 0; i < photoCount; i++) {
                    const url = record.photos?.[i] || "";
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
            const safeLayerName = getCleanLayerName(activeKmlId, kmlLayerName);
            const csvStoragePath = buildStoragePath(safeLayerName, `${safeLayerName}_清查總表.csv`);

            if (typeof firebase === 'undefined' || !firebase.storage) {
                throw new Error("Firebase Storage SDK 未初始化！");
            }

            const storageRef = firebase.storage().ref().child(csvStoragePath);
            return await storageRef.put(blob, { contentType: 'text/csv' });

        } catch (err) {
            console.error("❌ [CSV 失敗] 上傳失敗原因：", err);
            if (typeof window.downloadCsvFallback === 'function') {
                window.downloadCsvFallback(csvContent, `${kmlLayerName || '清查'}_總表.csv`);
            }
        }
    }

    window.downloadCsvFallback = function(csvData, filename) {
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
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
            const safeValue = escapeHtml(opt.value);

            listHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid #eee;">
                    <div>
                        <div style="font-weight:bold; font-size:14px;">${escapeHtml(baseName)}</div>
                        ${isAuditing ? `<div style="color: #e67e22; font-size:12px;">清查中：需照片 ${targetPhotos} 張</div>` : `<div style="color: #999; font-size: 12px;">未開啟清查</div>`}
                    </div>
                    <div style="display:flex; gap:6px;">
                        ${isAuditing ? `
                            <button onclick="window.downloadAuditPhotosZip('${safeValue}')" title="下載此圖層所有照片為 ZIP" style="background:#8e44ad; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:12px;">
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
        
        Swal.fire({ 
            title: '圖層清查管理 (v3.07)', 
            html: listHtml, 
            showConfirmButton: false, 
            showCloseButton: true 
        });
    };

    window.toggleAuditStatus = async function(kmlId, status) {
        if (!checkHasAuditPermission()) return;
        
        try {
            Swal.close(); 

            if (status) {
                const savedOptions = localStorage.getItem('audit_status_options');
                const defaultStatusStr = savedOptions 
                    ? JSON.parse(savedOptions).join(', ') 
                    : '正常, 損壞, 遺失';

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

                        const optionsArray = statusVal
                            .split(/[,，\n]/)
                            .map(s => s.trim())
                            .filter(Boolean);

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
                    
                    await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ 
                        isAuditing: true, 
                        targetPhotos: count,
                        statusOptions: options
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
                
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ 
                    isAuditing: false 
                }, { merge: true });
                
                if (!window.globalAuditConfigs[kmlId]) window.globalAuditConfigs[kmlId] = {};
                window.globalAuditConfigs[kmlId].isAuditing = false;

                syncAuditButtonVisibility();
                Swal.fire({ icon: 'success', title: '已關閉清查模式', timer: 1000, showConfirmButton: false });
            }
        } catch (error) {
            console.error("切換清查狀態失敗:", error);
            Swal.fire({
                icon: 'error',
                title: '同步至資料庫失敗',
                text: `請檢查網路連線或權限設定。\n(${error.message})`,
                confirmButtonText: '返回管理視窗'
            }).then(() => {
                window.showAuditActionModal();
            });
        }
    };
        
    // ---------------------------------------------------------
    // 5. 手動新增與自訂點位彈窗 UI
    // ---------------------------------------------------------
    window.startAddCustomPoint = function(kmlId) {
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

        if (activeAddPointCleanup) activeAddPointCleanup();

        const container = map.getContainer();
        container.style.cursor = 'crosshair';

        Swal.mixin({
            toast: true,
            position: 'top',
            showConfirmButton: false,
            timer: 4000,
            timerProgressBar: true
        }).fire({ 
            icon: 'info', 
            title: '📍 請在地圖上點擊要新增點位的實體位置 (按 ESC 取消)' 
        });

        const handleMapClick = async function(e) {
            cleanup();
            const { lat, lng } = e.latlng;
            if (typeof window.openCustomPointModal === 'function') {
                await window.openCustomPointModal({
                    isEditMode: false,
                    kmlId: targetKmlId,
                    lat: lat,
                    lng: lng,
                    status: '新增'
                });
            }
        };

        const handleKeydown = function(e) {
            if (e.key === 'Escape') {
                cleanup();
                Swal.fire({ icon: 'info', title: '已取消新增點位', timer: 1000, showConfirmButton: false });
            }
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
            btn.innerHTML = '➕ 新增點位';
            document.body.appendChild(btn);
        }

        btn.setAttribute('style', `
            position: fixed !important;
            bottom: 20px !important;
            right: 15px !important;
            z-index: 4000 !important;
            background-color: #2ecc71 !important;
            color: #ffffff !important;
            border: none !important;
            padding: 8px 20px !important;
            border-radius: 25px !important;
            font-weight: bold !important;
            font-size: 15px !important;
            box-shadow: 0 3px 10px rgba(0,0,0,0.3) !important;
            cursor: pointer !important;
            display: none !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 6px !important;
            outline: none !important;
            line-height: 1.4 !important;
            white-space: nowrap !important;
        `);

        btn.onclick = function(e) {
            e.stopPropagation();
            window.startAddCustomPoint();
        };

        syncAuditButtonVisibility();
    })();

    document.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'kmlLayerSelect') {
            setTimeout(() => syncAuditButtonVisibility(), 100);
        }
    });

    window.openCustomPointModal = async function(params, defaultLat, defaultLng) {
        let config = (typeof params === 'object' && params !== null) ? params : {
            kmlId: params,
            lat: defaultLat,
            lng: defaultLng,
            isEditMode: false
        };

        const {
            isEditMode = false,
            oldPointKey = '',
            pointKey = '',
            status = '新增',
            remark = '',
            photos = [],
            lat = 0,
            lng = 0
        } = config;

        const currentKmlId = config.kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        
        // 💡 讀取該圖層設定的照片張數 (若無設定則預設為 2 張，與既有點位一致)
        const layerConfig = window.globalAuditConfigs?.[currentKmlId] || {};
        const maxPhotos = layerConfig.targetPhotos || 2;

        let photoHtml = '';

        for (let i = 0; i < maxPhotos; i++) {
            const existingPhoto = photos[i] || '';
            const hasExisting = typeof existingPhoto === 'string' && existingPhoto.length > 0;
            const displayImg = hasExisting ? 'block' : 'none';
            const displayIcon = hasExisting ? 'none' : 'block';
            const tagText = hasExisting ? '已有照片' : '圖庫/拍照';

            photoHtml += `
                <div style="position:relative; margin-bottom:18px;">
                    <div style="border:2px dashed #ccc; height:85px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:8px; overflow:hidden;">
                        <img id="add-prev-${i}" src="${hasExisting ? safeEscape(existingPhoto) : ''}" style="width:100%; height:100%; object-fit:cover; display:${displayImg}; position:absolute; top:0; left:0; z-index:1;">
                        <span id="add-icon-${i}" style="font-size:24px; color:#bbb; display:${displayIcon}; z-index:1;">📷</span>
                        <input type="file" id="add-photo-input-${i}" accept="image/*" capture="environment" onchange="window.handleAddPhotoPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;" title="現場拍照">
                    </div>
                    <div id="add-tag-${i}" style="position:absolute; left:50%; transform:translateX(-50%); bottom:-10px; z-index:3; background:#444; color:#fff; font-size:11px; padding:2px 8px; border-radius:10px; display:flex; align-items:center; gap:3px; white-space:nowrap;">
                        <span>📷</span> <span id="add-tag-text-${i}">${tagText}</span>
                    </div>
                </div>`;
        }

        const kmlLayerName = getCleanLayerName(currentKmlId);
        const titleText = isEditMode ? '修改自訂點位紀錄' : '新增點位清查紀錄';
        const titleIcon = isEditMode ? '✏️' : '➕';
        const confirmBtnText = isEditMode ? '確認並儲存修改' : '確認並新增上傳';

        const modalHtml = `
        <div style="text-align: left; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; padding: 0 5px;">
            <div style="text-align: center; font-size: 20px; font-weight: bold; color: #4a4a4a; margin-bottom: 20px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <span style="color: #2ecc71; font-size: 24px; font-weight: 900;">${titleIcon}</span>
                <span>${titleText}</span>
            </div>
            <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 15px; font-weight: bold; color: #4a4a4a; margin-bottom: 8px;">
                    點位名稱 / 點名 <span style="color: #e74c3c;">*必填</span>
                </label>
                <input type="text" id="add-point-name" value="${safeEscape(pointKey)}" placeholder="例如：新設電桿-01" style="width: 100%; padding: 10px 14px; font-size: 15px; border: 1px solid #dcdfe6; border-radius: 8px; outline: none; box-sizing: border-box; color: #333; background-color: #fff;">
            </div>
            <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 15px; font-weight: bold; color: #4a4a4a; margin-bottom: 8px;">設備狀態</label>
                <div style="width: 100%; padding: 10px 16px; font-size: 16px; font-weight: bold; color: #27ae60; background-color: #e8f8f5; border: 1px solid #a3e4d7; border-radius: 8px; box-sizing: border-box;">${safeEscape(status || '新增')}</div>
            </div>
            <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 15px; font-weight: bold; color: #4a4a4a; margin-bottom: 8px;">
                    現場照片 (需拍 ${maxPhotos} 張) <span style="color: #e74c3c;">*必填</span>
                </label>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(95px, 1fr)); gap: 10px;">${photoHtml}</div>
            </div>
            <div style="margin-bottom: 0px;">
                <label style="display: block; font-size: 15px; font-weight: bold; color: #4a4a4a; margin-bottom: 8px;">
                    備註事項 <span style="color: #909399; font-weight: normal;">(選填)</span>
                </label>
                <textarea id="add-point-remark" placeholder="輸入備註事項..." style="width: 100%; height: 80px; padding: 10px 14px; font-size: 15px; border: 1px solid #dcdfe6; border-radius: 8px; outline: none; box-sizing: border-box; resize: vertical; color: #333; font-family: inherit;">${safeEscape(remark)}</textarea>
            </div>
        </div>`;

        const { value: formValues } = await Swal.fire({
            html: modalHtml,
            showCancelButton: true,
            confirmButtonText: confirmBtnText,
            cancelButtonText: '取消',
            confirmButtonColor: '#2ecc71',
            cancelButtonColor: '#707a86',
            focusConfirm: false,
            preConfirm: () => {
                const name = document.getElementById('add-point-name').value.trim();
                const inputRemark = document.getElementById('add-point-remark').value.trim();
                
                const finalPhotos = [];
                for (let i = 0; i < maxPhotos; i++) {
                    const fileInput = document.getElementById(`add-photo-input-${i}`);
                    if (fileInput?.files?.[0]) {
                        finalPhotos.push(fileInput.files[0]);
                    } else if (photos[i]) {
                        finalPhotos.push(photos[i]);
                    }
                }

                if (!name) {
                    Swal.showValidationMessage('請填寫點位名稱！');
                    return false;
                }
                if (finalPhotos.length < maxPhotos) {
                    Swal.showValidationMessage(`請提供完整 ${maxPhotos} 張現場照片！`);
                    return false;
                }

                return {
                    kmlId: currentKmlId,
                    kmlLayerName: kmlLayerName,
                    lat: lat,
                    lng: lng,
                    pointKey: name,
                    name: name,
                    status: status || '新增',
                    remark: inputRemark,
                    photos: finalPhotos,
                    isEditMode: isEditMode,
                    oldPointKey: oldPointKey || pointKey
                };
            }
        });

        if (formValues && typeof window.submitNewCustomPoint === 'function') {
            await window.submitNewCustomPoint(formValues);
        }
    };
    
    window.openAddPointModal = function(kmlId, lat, lng) {
        return window.openCustomPointModal({ kmlId, lat, lng, isEditMode: false });
    };

    window.handleAddPhotoPreview = function(input, index) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = document.getElementById(`add-prev-${index}`);
                const icon = document.getElementById(`add-icon-${index}`);
                const tagText = document.getElementById(`add-tag-text-${index}`);

                if (img) {
                    img.src = e.target.result;
                    img.style.display = 'block';
                }
                if (icon) icon.style.display = 'none';
                if (tagText) tagText.innerText = '已選取新圖';
            };
            reader.readAsDataURL(input.files[0]);
        }
    };

// ---------------------------------------------------------
    // 5.4 送出與刪除自訂點位邏輯
    // ---------------------------------------------------------
    window.submitNewCustomPoint = async function(formValues) {
        const { kmlId, kmlLayerName, lat, lng, pointKey, status, remark, photos, isEditMode, oldPointKey } = formValues;
        const trimmedPointKey = (pointKey || '').trim();

        if (!trimmedPointKey) {
            Swal.fire('提示', '請輸入點位名稱', 'warning');
            return;
        }

        const numLat = parseFloat(lat);
        const numLng = parseFloat(lng);
        if (isNaN(numLat) || isNaN(numLng)) {
            Swal.fire('錯誤', '請提供有效的經緯度座標', 'error');
            return;
        }

        const ns = window.mapNamespace;
        const currentRecords = window.auditLayersState?.[kmlId] || {};

        if (!isEditMode || (isEditMode && oldPointKey !== trimmedPointKey)) {
            let isDuplicateInKml = ns?.allKmlFeatures?.some(f => {
                const name = f.properties?.name || f.properties?.title || f.properties?.auditPointKey;
                return name === trimmedPointKey;
            });
            const isDuplicateInState = !!currentRecords[trimmedPointKey];

            if (isDuplicateInKml || isDuplicateInState) {
                Swal.fire({
                    icon: 'warning',
                    title: '點位名稱重複',
                    text: `點名「${trimmedPointKey}」已存在！請更改點名後重試。`,
                    confirmButtonText: '返回修改點名'
                });
                return;
            }
        }

        Swal.fire({ title: '正在處理並儲存資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

        try {
            let photoUrls = [];
            if (typeof window.uploadPhotosToStorage === 'function') {
                photoUrls = await window.uploadPhotosToStorage(photos, kmlId, trimmedPointKey, kmlLayerName);
            } else {
                photoUrls = Array.isArray(photos) ? photos.filter(p => typeof p === 'string') : [];
            }

            if (isEditMode && oldPointKey && oldPointKey !== trimmedPointKey) {
                if (window.auditLayersState?.[kmlId]) {
                    delete window.auditLayersState[kmlId][oldPointKey];
                }
                if (ns && Array.isArray(ns.allKmlFeatures)) {
                    ns.allKmlFeatures = ns.allKmlFeatures.filter(f => {
                        const name = f.properties?.name || f.properties?.title || f.properties?.auditPointKey;
                        return name !== oldPointKey;
                    });
                }
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(oldPointKey).delete();
            }

            const structuredData = {
                pointName: trimmedPointKey,
                status: "已完成",
                deviceStatus: status || "新增",
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
                    name: trimmedPointKey,
                    title: trimmedPointKey,
                    kmlId: kmlId,
                    auditPointKey: trimmedPointKey,
                    isCustomPoint: true,
                    isAudited: true,
                    auditStatus: status || "新增",
                    auditNote: remark || "",
                    photos: photoUrls,
                    fillColor: "#FCD770",
                    color: "#ffffff",
                    radius: 8,
                    fillOpacity: 0.85
                }
            };

            if (ns) {
                if (!Array.isArray(ns.allKmlFeatures)) ns.allKmlFeatures = [];
                const existingIdx = ns.allKmlFeatures.findIndex(f => {
                    const name = f.properties?.name || f.properties?.title || f.properties?.auditPointKey;
                    return name === trimmedPointKey;
                });
                if (existingIdx >= 0) {
                    ns.allKmlFeatures[existingIdx] = newGeoJsonFeature;
                } else {
                    ns.allKmlFeatures.push(newGeoJsonFeature);
                }
            }

            await firebase.firestore()
                .collection(APP_PATH)
                .doc(kmlId)
                .collection('auditRecords')
                .doc(trimmedPointKey)
                .set(structuredData, { merge: true });

            const layerFolderName = getCleanLayerName(kmlId, kmlLayerName);
            const targetPhotosCount = window.globalAuditConfigs?.[kmlId]?.targetPhotos || 2;
            if (typeof generateLayerCsvReport === 'function') {
                await generateLayerCsvReport(kmlId, layerFolderName, targetPhotosCount);
            }

            // 即時繪製：建立 CircleMarker 呈現在地圖上
            if (ns && ns.map && typeof L !== 'undefined') {
                const currentKmlGroup = ns.geoJsonLayers?.[kmlId] || ns.kmlLayerCache?.[kmlId];
                
                const newMarker = L.circleMarker([numLat, numLng], {
                    radius: 8,
                    fillColor: "#FCD770",
                    color: "#ffffff",
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.85
                });

                newMarker.feature = newGeoJsonFeature;
                newMarker.on('click', function(e) {
                    L.DomEvent.stopPropagation(e);
                    window.currentSelectedPoint = newMarker;
                    if (typeof updateBottomBtnState === 'function') {
                        updateBottomBtnState();
                    }
                });

                if (currentKmlGroup && typeof currentKmlGroup.addLayer === 'function') {
                    currentKmlGroup.addLayer(newMarker);
                } else {
                    newMarker.addTo(ns.map);
                }
            }

            Swal.fire({
                icon: 'success',
                title: isEditMode ? '修改點位成功' : '新增清查點位成功',
                timer: 1200,
                showConfirmButton: false
            });

            forceMapRefresh();
            setTimeout(updateBottomBtnState, 300);

        } catch (e) {
            console.error("❌ 儲存點位失敗:", e);
            Swal.fire('錯誤', e.message || '儲存失敗', 'error');
        }
    };

    window.uploadPhotosToStorage = async function(photos, kmlId, pointKey, kmlLayerName) {
        if (!photos || !Array.isArray(photos) || photos.length === 0) return [];

        if (typeof firebase === 'undefined' || !firebase.storage) {
            throw new Error("Firebase Storage SDK 未載入");
        }

        const targetLayerFolder = getCleanLayerName(kmlId, kmlLayerName);
        const storageRef = firebase.storage().ref();
        const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');

        const uploadPromises = photos.map(async (photoData, index) => {
            if (!photoData) return '';
            if (typeof photoData === 'string' && !photoData.startsWith('data:image')) {
                return photoData;
            }

            const photoIndexStr = String(index + 1).padStart(2, '0');
            const customStoragePath = `${STORAGE_ROOT}/${targetLayerFolder}/${safePointKey}_${photoIndexStr}.jpg`;
            const ref = storageRef.child(customStoragePath);

            try {
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
            } catch (uploadError) {
                console.error(`❌ 照片 ${index + 1} 上傳失敗:`, uploadError);
                throw new Error(`照片 ${index + 1} 上傳失敗: ${uploadError.message}`);
            }
        });

        return await Promise.all(uploadPromises);
    };

// ---------------------------------------------------------
    // 刪除自訂點位邏輯
    // ---------------------------------------------------------
    window.deleteCustomPoint = async function(kmlId, pointKey, kmlLayerName) {
        const confirmDelete = await Swal.fire({
            title: '確定要刪除此點位？',
            text: `點名：${pointKey}（將同步刪除 Firestore 紀錄與地圖圖層）`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: '是的，刪除！',
            cancelButtonText: '取消'
        });

        if (!confirmDelete.isConfirmed) return;

        Swal.fire({ title: '正在刪除資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

        try {
            const config = window.globalAuditConfigs?.[kmlId] || {};
            const targetLayerFolder = getCleanLayerName(kmlId, kmlLayerName);

            // 1. 從 Firestore 刪除資料
            await firebase.firestore()
                .collection(APP_PATH)
                .doc(kmlId)
                .collection('auditRecords')
                .doc(pointKey)
                .delete();

            // 2. 清除前端全域狀態中的記憶
            if (window.auditLayersState?.[kmlId]) {
                delete window.auditLayersState[kmlId][pointKey];
            }

            const ns = window.mapNamespace;
            if (ns) {
                // 3. 從 GeoJSON 特徵列表中移除該點位
                if (Array.isArray(ns.allKmlFeatures)) {
                    ns.allKmlFeatures = ns.allKmlFeatures.filter(f => {
                        const name = f.properties?.name || f.properties?.title || f.properties?.auditPointKey;
                        return name !== pointKey;
                    });
                }

                // 4. 即時從 Leaflet 地圖畫面上下架並移除 Marker
                const currentGeoJsonLayer = ns.geoJsonLayers?.[kmlId] || ns.kmlLayerCache?.[kmlId];
                if (currentGeoJsonLayer && typeof currentGeoJsonLayer.eachLayer === 'function') {
                    currentGeoJsonLayer.eachLayer(layer => {
                        const prop = layer.feature?.properties || {};
                        const layerPointName = prop.name || prop.title || prop.auditPointKey;
                        if (layerPointName === pointKey) {
                            if (currentGeoJsonLayer.removeLayer) {
                                currentGeoJsonLayer.removeLayer(layer);
                            }
                            if (ns.map && typeof ns.map.removeLayer === 'function') {
                                ns.map.removeLayer(layer);
                            }
                        }
                    });
                }
            }

            window.currentSelectedPoint = null;
            
            // 5. 重新生成 CSV 報表
            const targetPhotosCount = config.targetPhotos || 2;
            if (typeof generateLayerCsvReport === 'function') {
                await generateLayerCsvReport(kmlId, targetLayerFolder, targetPhotosCount);
            }

            Swal.fire({ icon: 'success', title: '已順利刪除點位與照片', timer: 1200, showConfirmButton: false });

            // 6. 重新刷新地圖與按鈕狀態
            forceMapRefresh();
            setTimeout(updateBottomBtnState, 300);

        } catch (e) {
            console.error("❌ 刪除點位失敗:", e);
            Swal.fire('錯誤', e.message || '刪除失敗', 'error');
        }
    };

    // ---------------------------------------------------------
    // 6. 清查資料編輯、修改與刪除紀錄邏輯 (含選單防護)
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
        const kmlLayerName = getCleanLayerName(kmlId); 

        const historyRecord = isModifyMode ? (window.auditLayersState?.[kmlId]?.[pointKey] || {}) : {};

        const isUserCreatedPoint = !!(
            layerProps.isCustom || 
            layerProps.isCustomPoint ||
            layerProps.isNew || 
            historyRecord.deviceStatus === '新增' ||
            layerProps.deviceStatus === '新增'
        );

        const currentPhotos = new Array(maxPhotos).fill('');
        if (isModifyMode && Array.isArray(historyRecord.photos)) {
            historyRecord.photos.forEach((url, idx) => {
                if (idx < maxPhotos) currentPhotos[idx] = url || '';
            });
        }

        const currentStatus = isUserCreatedPoint ? '新增' : (historyRecord.deviceStatus || '');
        const currentNote = historyRecord.note || '';

        const layerConfig = window.globalAuditConfigs?.[kmlId] || {};
        const rawOptions = layerConfig.statusOptions || 
            (localStorage.getItem('audit_status_options') ? JSON.parse(localStorage.getItem('audit_status_options')) : ['正常','損壞','遺失']);

        let statusSelectHtml = '';
        if (isUserCreatedPoint) {
            statusSelectHtml = `
                <select id="swal-status" class="swal2-input" disabled style="width:100%; margin:6px 0 16px 0; background-color:#e9ecef; color:#495057; cursor:not-allowed;">
                    <option value="新增" selected>新增</option>
                </select>`;
        } else {
            const filteredOptions = rawOptions.filter(opt => opt !== '新增');
            const statusOptionsHtml = filteredOptions.map(opt => 
                `<option value="${opt}" ${currentStatus === opt ? 'selected' : ''}>${opt}</option>`
            ).join('');
            
            statusSelectHtml = `
                <select id="swal-status" class="swal2-input" style="width:100%; margin:6px 0 16px 0;">
                    <option value="" ${!currentStatus ? 'selected' : ''}>--- 請選擇設備狀態 ---</option>
                    ${statusOptionsHtml}
                </select>`;
        }

        const previewHandler = function(input, index) {
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
                        
                        const prevEl = document.getElementById('audit-prev-' + index);
                        const iconEl = document.getElementById('audit-icon-' + index);
                        const tagEl = document.getElementById('audit-tag-' + index);

                        if (prevEl) { prevEl.src = base64; prevEl.style.display = 'block'; }
                        if (iconEl) { iconEl.style.display = 'none'; }
                        if (tagEl) { tagEl.innerHTML = '<span>🖼️</span> 新選擇'; }

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
            const isUrl = photoData.startsWith('http');
            
            photoHtml += `
                <div style="position:relative; margin-bottom:18px;">
                    <div style="border:2px dashed #ccc; height:85px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:8px; overflow:hidden;">
                        <img id="audit-prev-${i}" src="${safeEscape(photoData)}" style="width:100%; height:100%; object-fit:cover; display:${photoData ? 'block' : 'none'}; position:absolute; top:0; left:0; z-index:1;">
                        <span id="audit-icon-${i}" style="font-size:24px; color:#bbb; display:${photoData ? 'none' : 'block'}; z-index:1;">📷</span>
                        <input type="file" id="audit-file-input-${i}" accept="image/*" capture="environment" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;" title="點擊拍攝或更換照片">
                    </div>
                    <div id="audit-tag-${i}" style="position:absolute; left:50%; transform:translateX(-50%); bottom:-10px; z-index:3; background:#444; color:#fff; font-size:11px; padding:2px 8px; border-radius:10px; display:flex; align-items:center; gap:3px; white-space:nowrap;">
                        ${isUrl ? '<span>🖼️</span> 舊照片' : (photoData ? '<span>🖼️</span> 新選擇' : '<span>📷</span> 拍攝/上傳')}
                    </div>
                </div>`;
        }

        const { value: res, isDenied } = await Swal.fire({
            title: `<div style="font-size:18px;">${isModifyMode ? '修改' : '填寫'}清查紀錄：${escapeHtml(pointKey)}</div>`,
            html: `<div style="text-align:left;">
                <label style="font-size:14px; font-weight:bold;">設備狀態 <span style="color:red;">*必選</span></label>
                ${statusSelectHtml}

                <label style="font-size:14px; font-weight:bold;">現場照片 (需滿 ${maxPhotos} 張) <span style="color:red;">*必填</span></label>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(95px, 1fr)); gap:10px; margin:8px 0 16px 0;">
                    ${photoHtml}
                </div>

                <label style="font-size:14px; font-weight:bold;">備註事項 <span style="color:#888; font-weight:normal;">(選填)</span></label>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%; height:70px; margin:6px 0 0 0; resize:vertical;" placeholder="輸入備註事項...">${escapeHtml(currentNote)}</textarea>
            </div>`,
            showCancelButton: true,
            showDenyButton: isUserCreatedPoint,
            denyButtonText: '🗑️ 刪除點位',
            denyButtonColor: '#e74c3c',
            confirmButtonText: isModifyMode ? '覆蓋更新' : '確認並上傳',
            cancelButtonText: '取消',
            didOpen: () => {
                for (let i = 0; i < maxPhotos; i++) {
                    const inputEl = document.getElementById(`audit-file-input-${i}`);
                    if (inputEl) {
                        inputEl.addEventListener('change', (e) => previewHandler(e.target, i));
                    }
                }
            },
            preConfirm: () => {
                const statusValue = document.getElementById('swal-status').value;
                if (!statusValue) { 
                    Swal.showValidationMessage('請選擇設備狀態'); 
                    return false; 
                }
                const validPhotosCount = currentPhotos.filter(p => p && p.trim() !== '').length;
                if (validPhotosCount < maxPhotos) { 
                    Swal.showValidationMessage(`請補滿 ${maxPhotos} 張照片 (目前 ${validPhotosCount}/${maxPhotos})`); 
                    return false; 
                }
                return { 
                    status: statusValue, 
                    note: document.getElementById('swal-note').value, 
                    photos: currentPhotos 
                };
            }
        });

        if (isDenied) {
            await deleteCustomPoint(kmlId, pointKey, kmlLayerName);
            return;
        }
        
        if (res) {
            Swal.fire({ title: '正在上傳與更新資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');
                
                const uploadPromises = res.photos.map(async (photoData, i) => {
                    if (photoData && photoData.startsWith('data:image')) {
                        const photoIndexStr = String(i + 1).padStart(2, '0');
                        // 💡 完全對齊舊版 Storage 上傳路徑格式，並加上 safePointKey
                        const customStoragePath = `${STORAGE_ROOT}/${kmlLayerName}/${safePointKey}_${photoIndexStr}.jpg`;
                        const ref = firebase.storage().ref().child(customStoragePath);
                        const blob = await (await fetch(photoData)).blob();
                        await ref.put(blob);
                        return await ref.getDownloadURL();
                    }
                    return photoData || '';
                });

                const photoUrls = await Promise.all(uploadPromises);
                
                const structuredData = {
                    pointName: pointKey,
                    status: "已完成",
                    deviceStatus: res.status, 
                    note: res.note, 
                    photos: photoUrls, 
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                if (!window.auditLayersState) window.auditLayersState = {};
                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][pointKey] = structuredData;

                await firebase.firestore()
                    .collection(APP_PATH)
                    .doc(kmlId)
                    .collection('auditRecords')
                    .doc(pointKey) 
                    .set(structuredData, { merge: true });
                
                await generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos);

                Swal.fire({ icon: 'success', title: '更新成功', timer: 1000, showConfirmButton: false });
                
                forceMapRefresh();
                setTimeout(updateBottomBtnState, 300);
            } catch (e) { 
                console.error("儲存清查資料失敗:", e);
                Swal.fire('錯誤', e.message || '儲存失敗', 'error'); 
            }
        }
    };
    
    // ---------------------------------------------------------
    // 7. 查看詳細紀錄與下載 ZIP 專用
    // ---------------------------------------------------------
    window.viewAuditDetailOnly = function(pointKey) {
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const record = window.auditLayersState[kmlId]?.[pointKey];
        if (!record) return;

        let imagesHtml = '';
        if (Array.isArray(record.photos)) {
            record.photos.forEach(url => {
                if (url) imagesHtml += `<img src="${escapeHtml(url)}" style="width:45%; margin:2%; max-height:120px; object-fit:cover; border-radius:6px; border:1px solid #ccc;">`;
            });
        }

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

    window.downloadAuditPhotosZip = async function(kmlId) {
        if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
            Swal.fire('套件缺失', '請確保 HTML 已引入 JSZip 與 FileSaver 套件！', 'error');
            return;
        }

        const userRole = getUserRole().toLowerCase().trim();
        if (!['owner', 'editor'].includes(userRole)) {
            Swal.fire('權限不足', '只有 Editor 或 Owner 角色才能打包下載清查照片！', 'warning');
            return;
        }

        const cleanLayerName = getCleanLayerName(kmlId);

        Swal.fire({
            title: '正在搜尋 Storage 照片...',
            html: `<div id="zip-progress-text" style="font-size:14px; margin-top:10px;">請稍候...</div>`,
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const progressEl = document.getElementById('zip-progress-text');

        try {
            const storageFolderPath = buildStoragePath(cleanLayerName, '');
            const folderRef = firebase.storage().ref(storageFolderPath);
            const listResult = await folderRef.listAll();

            if (listResult.items.length === 0) {
                Swal.fire('提示', `Storage 下找不到任何照片檔案。`, 'info');
                return;
            }

            const items = listResult.items;
            if (progressEl) progressEl.textContent = `找到 ${items.length} 個檔案，準備下載...`;

            const zip = new JSZip();
            const rootFolder = zip.folder(cleanLayerName);

            let completedCount = 0;
            let failCount = 0;
            const BATCH_SIZE = 3;

            for (let i = 0; i < items.length; i += BATCH_SIZE) {
                const batch = items.slice(i, i + BATCH_SIZE);

                await Promise.all(batch.map(async (fileRef) => {
                    try {
                        const downloadUrl = await fileRef.getDownloadURL();
                        const response = await fetch(downloadUrl);
                        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                        const blob = await response.blob();
                        rootFolder.file(fileRef.name, blob);
                    } catch (err) {
                        failCount++;
                        console.warn(`下載失敗 (${fileRef.name}):`, err);
                    } finally {
                        completedCount++;
                        if (progressEl) {
                            progressEl.textContent = `打包進度: (${completedCount}/${items.length})`;
                        }
                    }
                }));
            }

            if (completedCount - failCount === 0) {
                throw new Error('所有檔案下載皆失敗，請確認網路連線或 CORS 設定。');
            }

            if (progressEl) progressEl.textContent = '檔案下載完成，正在壓縮 ZIP...';

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            saveAs(zipBlob, `${cleanLayerName}_Storage照片總集.zip`);

            Swal.fire({
                icon: failCount > 0 ? 'warning' : 'success',
                title: '打包下載完成！',
                text: failCount > 0 
                    ? `成功打包 ${completedCount - failCount} 個檔案，失敗 ${failCount} 個`
                    : `已成功下載 ${completedCount} 個檔案`,
                timer: 2500,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('打包失敗:', error);
            Swal.fire({
                icon: 'error',
                title: '打包失敗',
                text: error.message || '發生未知錯誤'
            });
        }
    };

    // ---------------------------------------------------------
    // 8. 監聽與退場機制
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
        }, err => {
            console.warn("監聽圖層配置受限:", err.message);
        });
    };

    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        auditUnsubscribes[kmlId] = firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snapshot => {
                const updates = {};
                snapshot.forEach(doc => {
                    updates[doc.id] = doc.data();
                });
                window.auditLayersState[kmlId] = updates;
                forceMapRefresh(); 
            }, err => {
                console.warn(`監聽 ${kmlId} 紀錄失敗:`, err.message);
            });
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
    // 9. 地圖控制項初始化掛載
    // ---------------------------------------------------------
    let checkAttempts = 0;
    const maxAttempts = 30; 
    const checkMapInterval = setInterval(() => {
        checkAttempts++;
        if (window.mapNamespace?.map && typeof L !== 'undefined') {
            clearInterval(checkMapInterval);
            
            const AuditMenu = L.Control.extend({
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                    this._container.style.display = 'none';
                    this._container.style.position = 'fixed';
                    this._container.style.bottom = '35px';
                    this._container.style.left = '50%';
                    this._container.style.transform = 'translateX(-50%)';
                    this._container.style.zIndex = '5000'; 
                    this._container.style.pointerEvents = 'none';
                    this._container.style.background = 'transparent';
                    this._container.style.padding = '0';
                    this._container.style.boxShadow = 'none';
                    this._container.style.gap = '12px';
                    return this._container;
                }
            });
            bottomControl = new AuditMenu();
            bottomControl.addTo(window.mapNamespace.map);
            
            initGlobalConfigListener();
        } else if (checkAttempts >= maxAttempts) {
            clearInterval(checkMapInterval);
            console.warn("Leaflet 地圖載入逾時。");
        }
    }, 500);

})();