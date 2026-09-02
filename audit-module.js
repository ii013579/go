/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (v3.16 完整功能版)
 * 包含：V3.15 藍/黃點樣式與底部控制面板 + V3.16 視角鎖定與新增點位即時疊加
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
    // 0. 權限防護與安全轉義機制
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
            try {
                return JSON.stringify(str);
            } catch (e) {
                return '';
            }
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
    // 0.1 懸浮按鈕顯隱狀態同步 (全域)
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
    // 1. 樣式攔截器與強力重繪機制 (已清查: #FCD770, 未清查: #2A00D2)
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
                        f.properties.fillColor = "#FCD770"; // 已清查：黃色 (V3.15)
                        f.properties.radius = 8;
                    } else {
                        f.properties.isAudited = false;
                        f.properties.auditStatus = null;
                        f.properties.fillColor = "#2A00D2"; // 未清查：藍色 (V3.15)
                        f.properties.radius = 8;
                    }
                    f.properties.color = "#ffffff";
                    f.properties.fillOpacity = 0.85;
                } else {
                    f.properties.fillColor = "#e74c3c"; // 預設
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

        // V3.16 核心：鎖定當前畫面位置與縮放級別
        let currentCenter = null, currentZoom = null;
        if (ns.map) {
            currentCenter = ns.map.getCenter();
            currentZoom = ns.map.getZoom();
        }

        setTimeout(() => {
            if (ns.map && typeof ns.map.invalidateSize === 'function') {
                ns.map.invalidateSize({ animate: false });
            }
        }, 100);

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
                            layer.setStyle({
                                fillColor: "#FCD770", // 已清查：黃色 (V3.15)
                                color: "#ffffff",
                                weight: 2,
                                fillOpacity: 0.9,
                                radius: 10
                            });
                        }
                    } else {
                        props.isAudited = false;
                        if (typeof layer.setStyle === 'function') {
                            layer.setStyle({
                                fillColor: "#2A00D2", // 未清查：藍色 (V3.15)
                                color: "#ffffff",
                                weight: 2,
                                fillOpacity: 0.9,
                                radius: 10
                            });
                        }
                    }
                } else {
                    if (typeof layer.setStyle === 'function') {
                        layer.setStyle({
                            fillColor: "#e74c3c",
                            color: "#ffffff",
                            weight: 1.5,
                            fillOpacity: 0.85,
                            radius: 8
                        });
                    }
                }
            }
        });

        if (window.addGeoJsonLayers && ns.allKmlFeatures) {
            window.addGeoJsonLayers(ns.allKmlFeatures);
        }

        // V3.16 核心：精準聚焦回原本位置
        if (ns.map && currentCenter && currentZoom !== null) {
            ns.map.setView(currentCenter, currentZoom, { animate: false });
            setTimeout(() => {
                if (ns.map) ns.map.setView(currentCenter, currentZoom, { animate: false });
            }, 50);
        }

        syncAuditButtonVisibility();
    }
    window.forceMapRefresh = forceMapRefresh;

    // ---------------------------------------------------------
    // 2. 底部控制按鈕面板 (V3.15 佈局)
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

            let btnHtml = '';
            if (isAudited) {
                btnHtml = `
                    <button onclick="window.viewAuditDetailOnly('${safePointKey}')" 
                            style="background: #e91e63; ${btnBaseStyle}">
                        查看
                    </button>
                    <button onclick="window.openAuditEditor(true)" 
                            style="background: #f39c12; ${btnBaseStyle}">
                        修改
                    </button>
                `;
            } else {
                btnHtml = `
                    <button onclick="window.openAuditEditor(false)" 
                            style="background: #2ecc71; ${btnBaseStyle}">
                        清查點位
                    </button>
                `;
            }

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
    // 3. CSV 總表生成 (路徑嚴格鎖定)
    // ---------------------------------------------------------
    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos) {
        console.log(`[CSV] 開始生成總表 - KML ID: ${kmlId}, LayerName: ${kmlLayerName}`);
        
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

        const allPointKeys = new Set();
        featureMap.forEach((_, key) => allPointKeys.add(key));
        Object.keys(records).forEach(key => {
            if (key) allPointKeys.add(String(key));
        });

        allPointKeys.forEach(pointKey => {
            const record = records[pointKey]; 
            const feature = featureMap.get(pointKey);
            let rowArr = [];
            
            rowArr.push(`"${pointKey.replace(/"/g, '""')}"`);

            let lng = "";
            let lat = "";

            if (record && record.lng && record.lat) {
                lng = record.lng;
                lat = record.lat;
            } else if (feature && feature.geometry && feature.geometry.coordinates) {
                const coords = feature.geometry.coordinates;
                lng = coords[0] !== undefined ? coords[0] : "";
                lat = coords[1] !== undefined ? coords[1] : "";
            }

            rowArr.push(`"${lng}"`);
            rowArr.push(`"${lat}"`);

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
            rootPath = rootPath.replace(/^\/+|\/+$/g, ''); 
            
            const safeLayerName = kmlLayerName || 'default_layer';
            // 【路徑嚴格鎖定】
            const csvStoragePath = `${rootPath}/${safeLayerName}/${safeLayerName}_清查總表.csv`;

            if (typeof firebase === 'undefined' || !firebase.storage) {
                throw new Error("Firebase Storage SDK 未初始化！");
            }

            const storageRef = firebase.storage().ref().child(csvStoragePath);
            const snapshot = await storageRef.put(blob, { contentType: 'text/csv' });
            return snapshot;

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
                <div style="display:flex; align-items:center; justify-space-between; padding:12px; border-bottom:1px solid #eee;">
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
            title: '圖層清查管理', 
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

                        return {
                            count: countVal,
                            options: optionsArray
                        };
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
    // 5-1. 手動新增點位功能 & 地圖點擊拾取
    // ---------------------------------------------------------
    let activeAddPointCleanup = null;
    
    function setAddButtonActiveState(isActive) {
        const btn = document.getElementById('btn-standalone-add-point');
        if (!btn) return;
    
        if (isActive) {
            btn.innerHTML = '❌ 取消新增';
            btn.style.setProperty('background-color', '#e74c3c', 'important');
        } else {
            btn.innerHTML = '➕ 新增點位';
            btn.style.setProperty('background-color', '#2ecc71', 'important');
        }
    }
    
    window.startAddCustomPoint = function(kmlId) {
        if (activeAddPointCleanup) {
            activeAddPointCleanup();
            Swal.fire({ icon: 'info', title: '已取消新增點位', timer: 1000, showConfirmButton: false });
            return;
        }
    
        if (typeof checkHasAuditPermission === 'function' && !checkHasAuditPermission()) {
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
            toast: true,
            position: 'top',
            showConfirmButton: false,
            timer: 4000,
            timerProgressBar: true
        }).fire({ 
            icon: 'info', 
            title: '📍 請在地圖上點擊要新增點位的實體位置' 
        });
    
        const handleMapClick = async function(e) {
            cleanup();
            const { lat, lng } = e.latlng;
            if (typeof window.openAddPointModal === 'function') {
                await window.openAddPointModal(targetKmlId, lat, lng);
            } else if (typeof window.openCustomPointModal === 'function') {
                await window.openCustomPointModal({
                    isEditMode: false,
                    kmlId: targetKmlId,
                    lat: lat,
                    lng: lng,
                    status: '新增'
                });
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
    
    // ---------------------------------------------------------
    // 5-2. 動態渲染獨立「新增點位」膠囊按鈕
    // ---------------------------------------------------------
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
            box-shadow: 0 4px 10px rgba(0,0,0,0.3) !important;
            cursor: pointer !important;
            outline: none !important;
            transition: background 0.3s ease, transform 0.1s ease !important;
            display: none !important;
            align-items: center !important;
            justify-content: center !important;
        `);
    
        btn.addEventListener('mouseenter', () => btn.style.transform = 'scale(1.05)');
        btn.addEventListener('mouseleave', () => btn.style.transform = 'scale(1)');
        btn.addEventListener('mousedown', () => btn.style.transform = 'scale(0.95)');
        btn.addEventListener('mouseup', () => btn.style.transform = 'scale(1)');
    
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof window.startAddCustomPoint === 'function') {
                const kmlId = window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
                window.startAddCustomPoint(kmlId);
            }
        });
    })();
        
    // ---------------------------------------------------------
    // 5-3. 提交新增點位 (V3.16 新增即時繪製與視角鎖定)
    // ---------------------------------------------------------
    window.submitNewCustomPoint = async function(kmlId, pointKey, lat, lng, deviceStatus, remark) {
        if (!kmlId) return;
        
        let trimmedPointKey = (pointKey || "未命名點位").trim();
        let numLat = parseFloat(lat);
        let numLng = parseFloat(lng);
        
        let targetDeviceStatus = String(deviceStatus).trim() || '正常';
        let targetRemark = (remark || "").trim();
        
        Swal.fire({
            title: '儲存中...',
            text: '正在將新點位寫入雲端',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });
        
        try {
            const rootPath = (typeof STORAGE_ROOT !== 'undefined' && STORAGE_ROOT) 
                             ? STORAGE_ROOT 
                             : 'kmldata-d22fb/storage';
                             
            const appPath = (typeof APP_PATH !== 'undefined' && APP_PATH) 
                            ? APP_PATH 
                            : 'artifacts/kmldata-d22fb/public/data/kmlLayers';
            
            const timestamp = firebase.firestore.FieldValue.serverTimestamp();
            
            const newGeoJsonFeature = {
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [numLng, numLat]
                },
                properties: {
                    name: trimmedPointKey,
                    isCustomPoint: true,
                    description: "透過系統新增的自訂點位",
                    createdAt: new Date().toISOString()
                }
            };
            
            const structuredData = {
                deviceStatus: targetDeviceStatus,
                remark: targetRemark,
                photos: [],
                updatedAt: timestamp,
                updatedBy: getUserRole(),
                lat: numLat,
                lng: numLng,
                isCustomPoint: true,
                geoJsonFeature: JSON.stringify(newGeoJsonFeature)
            };
            
            const ns = window.mapNamespace;
            if (ns && Array.isArray(ns.allKmlFeatures)) {
                ns.allKmlFeatures.push(newGeoJsonFeature);
            }
            
            await firebase.firestore()
                .collection(appPath)
                .doc(kmlId)
                .collection('auditRecords')
                .doc(trimmedPointKey)
                .set(structuredData, { merge: true });
                
            // V3.16 即時繪製：立即掛載 CircleMarker (已清查黃色 #FCD770)
            if (ns && ns.map && typeof L !== 'undefined') {
                const isAuditing = window.globalAuditConfigs?.[kmlId]?.isAuditing && canSeeAuditColors();
                const marker = L.circleMarker([numLat, numLng], {
                    radius: isAuditing ? 10 : 8,
                    fillColor: isAuditing ? "#FCD770" : "#e74c3c",
                    color: "#ffffff",
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.85
                }).bindPopup(`<b>${escapeHtml(trimmedPointKey)}</b><br>狀態：${escapeHtml(targetDeviceStatus)}`);

                marker.feature = newGeoJsonFeature;
                marker.properties = newGeoJsonFeature.properties;
                marker.addTo(ns.map);

                marker.on('click', function() {
                    window.currentSelectedPoint = marker;
                    if (typeof updateBottomBtnState === 'function') updateBottomBtnState();
                });
            }

            if (typeof forceMapRefresh === 'function') {
                forceMapRefresh();
            } else if (ns && Array.isArray(ns.allKmlFeatures) && typeof window.addGeoJsonLayers === 'function') {
                window.addGeoJsonLayers(ns.allKmlFeatures);
            }
            
            let layerNameForCsv = kmlId;
            const select = document.getElementById('kmlLayerSelect');
            if (select) {
                const opt = Array.from(select.options).find(o => o.value === kmlId);
                if (opt) {
                    layerNameForCsv = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
                }
            }
            
            const targetPhotosCount = window.globalAuditConfigs?.[kmlId]?.targetPhotos || 2;
            await generateLayerCsvReport(kmlId, layerNameForCsv, targetPhotosCount);
            
            Swal.fire({
                icon: 'success',
                title: '新增點位成功！',
                timer: 1500,
                showConfirmButton: false
            });
            
        } catch (error) {
            console.error("新增點位失敗:", error);
            Swal.fire({
                icon: 'error',
                title: '寫入資料失敗',
                text: `儲存時發生錯誤：${error.message}`
            });
        }
    };
    
    // ---------------------------------------------------------
    // 5-4. 自訂點位表單 Modal
    // ---------------------------------------------------------
    window.openCustomPointModal = function(options = {}) {
        const {
            isEditMode = false,
            kmlId = "",
            pointKey = "",
            lat = "",
            lng = "",
            status = '新增',
            remark = ""
        } = options;
    
        const safePointKey = isEditMode ? escapeHtml(pointKey) : "";
        const safeLat = lat || "";
        const safeLng = lng || "";
        const safeRemark = escapeHtml(remark || "");
        const safeStatus = escapeHtml(status || "正常");
    
        const savedOptions = localStorage.getItem('audit_status_options');
        let statusOptions = ['正常', '損壞', '遺失'];
        if (savedOptions) {
            try {
                statusOptions = JSON.parse(savedOptions);
            } catch (e) {
                console.error("Parse status options error:", e);
            }
        }
    
        let statusSelectHtml = `<select id="swal-custom-status" class="swal2-select" style="width:100%; margin: 8px 0 16px 0;">`;
        statusOptions.forEach(opt => {
            const isSelected = (opt === safeStatus) ? 'selected' : '';
            statusSelectHtml += `<option value="${escapeHtml(opt)}" ${isSelected}>${escapeHtml(opt)}</option>`;
        });
        statusSelectHtml += `</select>`;
    
        const titleText = isEditMode ? '修改點位內容' : '新增自訂點位';
        const submitBtnText = isEditMode ? '儲存修改' : '確定新增';
        const readonlyAttr = isEditMode ? 'readonly style="background-color:#eee; cursor:not-allowed;"' : '';
    
        Swal.fire({
            title: titleText,
            html: `
                <div style="text-align:left; font-size:14px;">
                    <label style="font-weight:bold;">點位名稱/編號 <span style="color:red">*</span></label>
                    <input id="swal-custom-name" type="text" class="swal2-input" value="${safePointKey}" placeholder="請輸入點位名稱" style="width:100%; margin: 8px 0 16px 0;" ${readonlyAttr}>
                    
                    <label style="font-weight:bold;">狀態 <span style="color:red">*</span></label>
                    ${statusSelectHtml}
    
                    <label style="font-weight:bold;">緯度 (Lat)</label>
                    <input id="swal-custom-lat" type="number" step="0.00000001" class="swal2-input" value="${safeLat}" placeholder="23.xxxxx" style="width:100%; margin: 8px 0 16px 0;">
    
                    <label style="font-weight:bold;">經度 (Lng)</label>
                    <input id="swal-custom-lng" type="number" step="0.00000001" class="swal2-input" value="${safeLng}" placeholder="120.xxxxx" style="width:100%; margin: 8px 0 16px 0;">
    
                    <label style="font-weight:bold;">備註</label>
                    <textarea id="swal-custom-remark" class="swal2-textarea" placeholder="可填寫備註說明..." style="width:100%; margin: 8px 0; height:80px;">${safeRemark}</textarea>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: submitBtnText,
            cancelButtonText: '取消',
            preConfirm: () => {
                const cName = document.getElementById('swal-custom-name').value.trim();
                const cStatus = document.getElementById('swal-custom-status').value;
                const cLat = parseFloat(document.getElementById('swal-custom-lat').value);
                const cLng = parseFloat(document.getElementById('swal-custom-lng').value);
                const cRemark = document.getElementById('swal-custom-remark').value.trim();
    
                if (!cName) {
                    Swal.showValidationMessage('點位名稱不能為空！');
                    return false;
                }
                if (isNaN(cLat) || isNaN(cLng)) {
                    Swal.showValidationMessage('經緯度必須是有效的數字！');
                    return false;
                }
    
                return {
                    pointKey: cName,
                    lat: cLat,
                    lng: cLng,
                    deviceStatus: cStatus,
                    remark: cRemark
                };
            }
        }).then((result) => {
            if (result.isConfirmed) {
                const data = result.value;
                if (typeof window.submitNewCustomPoint === 'function') {
                    window.submitNewCustomPoint(kmlId, data.pointKey, data.lat, data.lng, data.deviceStatus, data.remark);
                }
            }
        });
    };

    // ---------------------------------------------------------
    // 6. 監聽 Firestore 即時快照
    // ---------------------------------------------------------
    function initAuditSnapshotListener(kmlId, kmlLayerName) {
        if (!kmlId) return;
        
        if (auditUnsubscribes[kmlId]) {
            auditUnsubscribes[kmlId]();
        }

        const auditRef = firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords');

        const unsubscribe = auditRef.onSnapshot(async (snapshot) => {
            console.log(`[即時監聽] 接收到 ${kmlId} 的清查紀錄快照！更新 ${snapshot.docs.length} 筆資料`);

            if (!window.auditLayersState[kmlId]) {
                window.auditLayersState[kmlId] = {};
            }
            
            snapshot.forEach(doc => {
                window.auditLayersState[kmlId][doc.id] = doc.data();
            });

            if (typeof forceMapRefresh === 'function') {
                forceMapRefresh();
            }
        }, error => {
            console.error(`[即時監聽] ${kmlId} 發生錯誤:`, error);
        });

        auditUnsubscribes[kmlId] = unsubscribe;
        console.log(`[即時監聽] 已啟動針對 ${kmlId} 的清查紀錄快照監聽`);
    }

    // ---------------------------------------------------------
    // 7. 外層 KML List 快照監聽
    // ---------------------------------------------------------
    function initGlobalKmlConfigListener() {
        const rootRef = firebase.firestore().collection(APP_PATH);

        rootRef.onSnapshot(snapshot => {
            snapshot.forEach(doc => {
                const kmlId = doc.id;
                const data = doc.data();
                
                if (!window.globalAuditConfigs[kmlId]) {
                    window.globalAuditConfigs[kmlId] = {};
                }

                window.globalAuditConfigs[kmlId].isAuditing = (data.isAuditing === true);
                if (data.targetPhotos) {
                    window.globalAuditConfigs[kmlId].targetPhotos = parseInt(data.targetPhotos);
                }
                
                if (window.mapNamespace && window.mapNamespace.currentKmlLayerId === kmlId) {
                    if (typeof forceMapRefresh === 'function') forceMapRefresh();
                }
            });
            syncAuditButtonVisibility();
        }, err => {
            console.error("Global KML config listener error:", err);
        });
    }

    window.initAuditSnapshotListener = initAuditSnapshotListener;

    // ---------------------------------------------------------
    // 8. JSZip 批次打包下載照片邏輯
    // ---------------------------------------------------------
    window.downloadAuditPhotosZip = async function(kmlId) {
        if (!checkHasAuditPermission()) {
            Swal.fire('權限不足', '您的帳號不允許執行下載作業！', 'warning');
            return;
        }

        const select = document.getElementById('kmlLayerSelect');
        let targetLayerName = kmlId;
        if (select) {
            const opt = Array.from(select.options).find(o => o.value === kmlId);
            if (opt) {
                targetLayerName = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
            }
        }

        const records = window.auditLayersState[kmlId];
        if (!records || Object.keys(records).length === 0) {
            Swal.fire('無照片可下載', '該圖層目前沒有任何已上傳的清查照片！', 'info');
            return;
        }

        Swal.fire({
            title: '打包照片中',
            html: `正在準備下載 ZIP...<br>圖層：${escapeHtml(targetLayerName)}`,
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            if (typeof JSZip === 'undefined') {
                await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
            }

            const zip = new JSZip();
            const folder = zip.folder(targetLayerName);
            let photoCount = 0;

            for (const [pointKey, record] of Object.entries(records)) {
                if (!record.photos || !Array.isArray(record.photos) || record.photos.length === 0) continue;

                for (let i = 0; i < record.photos.length; i++) {
                    const url = record.photos[i];
                    if (!url) continue;

                    try {
                        const response = await fetch(url);
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                        const blob = await response.blob();
                        
                        const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '-');
                        const photoIndexStr = String(i + 1).padStart(2, '0');
                        
                        const fileName = `${safePointKey}_${photoIndexStr}.jpg`;
                        folder.file(fileName, blob);
                        photoCount++;

                    } catch (fetchErr) {
                        console.warn(`無法下載照片 ${url}:`, fetchErr);
                    }
                }
            }

            if (photoCount === 0) {
                Swal.fire('下載中斷', '找不到有效的照片可以打包。', 'info');
                return;
            }

            Swal.update({ html: `已成功抓取 ${photoCount} 張照片<br>正在壓縮為 ZIP 檔...` });
            const zipBlob = await zip.generateAsync({ type: "blob" });

            const link = document.createElement('a');
            link.href = URL.createObjectURL(zipBlob);
            link.download = `${targetLayerName}_清查照片.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            URL.revokeObjectURL(link.href);

            Swal.fire({ icon: 'success', title: '下載完成', text: `共打包了 ${photoCount} 張照片`, timer: 2000, showConfirmButton: false });

        } catch (error) {
            console.error("ZIP 打包下載失敗:", error);
            Swal.fire('下載失敗', `打包過程中發生錯誤：${error.message}`, 'error');
        }
    };

    function loadScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // ---------------------------------------------------------
    // 9. UI 主面板 - 清查表單與詳細資料 (相片路徑嚴格鎖定)
    // ---------------------------------------------------------
    window.openAuditEditor = function(isEditMode) {
        const active = window.currentSelectedPoint;
        if (!active) return;
        
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const targetPhotosCount = window.globalAuditConfigs?.[kmlId]?.targetPhotos || 2;
        const configOptions = window.globalAuditConfigs?.[kmlId]?.statusOptions || ['正常', '損壞', '遺失'];
        
        const layerProps = active.feature?.properties || active.properties || {};
        const pointKey = layerProps.name || layerProps.title || layerProps.id || "未知點位";
        const safePointKey = escapeHtml(pointKey);
        
        const currentRecords = window.auditLayersState[kmlId] || {};
        const record = currentRecords[pointKey] || {};
        
        const defaultStatus = record.deviceStatus || '正常';
        const defaultRemark = record.note || record.remark || '';
        const existingPhotos = record.photos || [];

        let statusSelectHtml = `<select id="audit-status" class="swal2-select" style="width: 100%; max-width: 100%; margin: 5px 0 15px 0; font-size: 16px;">`;
        configOptions.forEach(opt => {
            const isSelected = (opt === defaultStatus) ? 'selected' : '';
            statusSelectHtml += `<option value="${escapeHtml(opt)}" ${isSelected}>${escapeHtml(opt)}</option>`;
        });
        statusSelectHtml += `</select>`;

        let photosHtml = `<div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:15px; justify-content:center;">`;
        for (let i = 0; i < targetPhotosCount; i++) {
            const hasPhoto = !!existingPhotos[i];
            const imgStyle = `width:100%; height:120px; object-fit:cover; border-radius:8px; border:2px dashed #ccc; cursor:pointer; background:#f9f9f9;`;
            const imgSrc = hasPhoto ? existingPhotos[i] : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="%23ccc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
            
            photosHtml += `
                <div style="flex:1; min-width:45%; max-width:48%; position:relative;">
                    <input type="file" id="audit-photo-${i}" accept="image/*" style="display:none;" 
                           onchange="window.previewLocalImage(this, 'img-preview-${i}', ${i})">
                    <div style="text-align:center; margin-bottom:5px; font-weight:bold; font-size:13px; color:#555;">
                        照片 ${i+1} ${hasPhoto ? '<span style="color:green;">(已上傳)</span>' : '<span style="color:red;">(必填)</span>'}
                    </div>
                    <img id="img-preview-${i}" src="${imgSrc}" style="${imgStyle}" 
                         onclick="document.getElementById('audit-photo-${i}').click()" 
                         title="點擊選擇或更換照片"
                         data-existing="${hasPhoto ? existingPhotos[i] : ''}">
                    <button id="btn-remove-photo-${i}" 
                            style="position:absolute; top:25px; right:5px; background:rgba(255,0,0,0.8); color:white; border:none; border-radius:50%; width:25px; height:25px; font-size:14px; line-height:25px; text-align:center; cursor:pointer; display:${hasPhoto ? 'block' : 'none'};" 
                            onclick="window.removeLocalPreview('img-preview-${i}', 'audit-photo-${i}', 'btn-remove-photo-${i}')">
                        ✕
                    </button>
                </div>
            `;
        }
        photosHtml += `</div>`;

        Swal.fire({
            title: `${isEditMode ? '修改' : '填寫'}清查紀錄`,
            html: `
                <div style="text-align:left; font-size: 15px; padding: 0 5px;">
                    <div style="margin-bottom: 12px; font-weight:bold; color:#2c3e50; border-bottom:1px solid #eee; padding-bottom:5px;">
                        點位名稱: <span style="color:#e74c3c;">${safePointKey}</span>
                    </div>
                    <label style="font-weight:bold; color:#34495e;">設備狀態</label>
                    ${statusSelectHtml}
                    <label style="font-weight:bold; color:#34495e;">現場照片 (要求 ${targetPhotosCount} 張)</label>
                    <div style="font-size:12px; color:#7f8c8d; margin-bottom:10px;">點擊虛線方塊來選擇或拍攝照片</div>
                    ${photosHtml}
                    <label style="font-weight:bold; color:#34495e; margin-top:10px; display:block;">備註說明</label>
                    <textarea id="audit-note" class="swal2-textarea" style="width: 100%; max-width: 100%; height: 80px; margin: 5px 0 0 0; font-size: 15px;">${escapeHtml(defaultRemark)}</textarea>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '確定上傳',
            cancelButtonText: '取消',
            confirmButtonColor: '#2ecc71',
            cancelButtonColor: '#e74c3c',
            width: '95%',
            customClass: { popup: 'mobile-swal-popup' },
            focusConfirm: false,
            preConfirm: async () => {
                const status = document.getElementById('audit-status').value;
                const note = document.getElementById('audit-note').value.trim();
                let files = [];
                let existingUrls = [];
                let missingCount = 0;

                for (let i = 0; i < targetPhotosCount; i++) {
                    const fileInput = document.getElementById(`audit-photo-${i}`);
                    const imgPreview = document.getElementById(`img-preview-${i}`);
                    const existingUrl = imgPreview.getAttribute('data-existing');
                    
                    if (fileInput.files.length > 0) {
                        files.push(fileInput.files[0]);
                        existingUrls.push(null); 
                    } else if (existingUrl) {
                        files.push(null);
                        existingUrls.push(existingUrl);
                    } else {
                        missingCount++;
                        files.push(null);
                        existingUrls.push(null);
                    }
                }

                if (missingCount > 0) {
                    Swal.showValidationMessage(`請補齊要求的 ${targetPhotosCount} 張照片！`);
                    return false;
                }

                Swal.fire({
                    title: '上傳中...',
                    html: '正在上傳照片與資料，請稍候<br><b id="upload-progress">0%</b>',
                    allowOutsideClick: false,
                    didOpen: () => Swal.showLoading()
                });

                try {
                    let rootPath = (typeof STORAGE_ROOT !== 'undefined' && STORAGE_ROOT) ? STORAGE_ROOT : 'kmldata-d22fb/storage';
                    rootPath = rootPath.replace(/^\/+|\/+$/g, ''); 
                    
                    let targetLayerName = kmlId;
                    const select = document.getElementById('kmlLayerSelect');
                    if (select) {
                        const opt = Array.from(select.options).find(o => o.value === kmlId);
                        if (opt) targetLayerName = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
                    }

                    const finalPhotoUrls = [];
                    for (let i = 0; i < targetPhotosCount; i++) {
                        if (files[i]) {
                            const file = files[i];
                            const photoIndexStr = String(i + 1).padStart(2, '0');
                            
                            // 【路徑嚴格鎖定】
                            const customStoragePath = `${rootPath}/${targetLayerName}/${safePointKey}_${photoIndexStr}.jpg`;
                            
                            const storageRef = firebase.storage().ref().child(customStoragePath);
                            const snapshot = await storageRef.put(file);
                            const downloadURL = await snapshot.ref.getDownloadURL();
                            finalPhotoUrls.push(downloadURL);
                            document.getElementById('upload-progress').innerText = `${Math.round(((i+1)/targetPhotosCount)*100)}%`;
                        } else if (existingUrls[i]) {
                            finalPhotoUrls.push(existingUrls[i]);
                            document.getElementById('upload-progress').innerText = `${Math.round(((i+1)/targetPhotosCount)*100)}%`;
                        }
                    }

                    const timestamp = firebase.firestore.FieldValue.serverTimestamp();
                    let structuredData = {
                        deviceStatus: status,
                        note: note,
                        remark: note,
                        photos: finalPhotoUrls,
                        updatedAt: timestamp,
                        updatedBy: getUserRole()
                    };

                    const isCustomPoint = (layerProps.isCustomPoint === true);
                    let geoJsonFeatureStr = "";

                    if (isCustomPoint) {
                        structuredData.isCustomPoint = true;
                        
                        let lat = layerProps.lat;
                        let lng = layerProps.lng;
                        
                        if (active.feature && active.feature.geometry && active.feature.geometry.coordinates) {
                            lng = active.feature.geometry.coordinates[0];
                            lat = active.feature.geometry.coordinates[1];
                        } else if (active.getLatLng && typeof active.getLatLng === 'function') {
                            const ll = active.getLatLng();
                            lat = ll.lat;
                            lng = ll.lng;
                        }
                        
                        if (lat !== undefined && lng !== undefined) {
                            structuredData.lat = parseFloat(lat);
                            structuredData.lng = parseFloat(lng);
                        }
                        
                        if (active.feature) {
                            geoJsonFeatureStr = JSON.stringify(active.feature);
                        } else {
                            const tempFeature = {
                                type: "Feature",
                                geometry: {
                                    type: "Point",
                                    coordinates: [structuredData.lng, structuredData.lat]
                                },
                                properties: layerProps
                            };
                            geoJsonFeatureStr = JSON.stringify(tempFeature);
                        }
                        structuredData.geoJsonFeature = geoJsonFeatureStr;
                    }

                    if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                    window.auditLayersState[kmlId][pointKey] = structuredData;

                    const appPath = (typeof APP_PATH !== 'undefined' && APP_PATH) ? APP_PATH : 'artifacts/kmldata-d22fb/public/data/kmlLayers';
                    
                    await firebase.firestore()
                        .collection(appPath)
                        .doc(kmlId)
                        .collection('auditRecords')
                        .doc(pointKey)
                        .set(structuredData, { merge: true });

                    await generateLayerCsvReport(kmlId, targetLayerName, targetPhotosCount);

                    Swal.fire({ icon: 'success', title: '更新成功', timer: 1000, showConfirmButton: false });

                    if (typeof forceMapRefresh === 'function') forceMapRefresh();
                    if (typeof updateBottomBtnState === 'function') setTimeout(updateBottomBtnState, 300);

                } catch (error) {
                    console.error("儲存失敗:", error);
                    Swal.fire('上傳失敗', `請檢查網路連線或儲存權限！\n(${error.message})`, 'error');
                }
            }
        });
    };

    window.previewLocalImage = function(input, imgId, index) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = document.getElementById(imgId);
                img.src = e.target.result;
                img.setAttribute('data-existing', ''); 
                
                const rmBtn = document.getElementById(`btn-remove-photo-${index}`);
                if (rmBtn) rmBtn.style.display = 'block';
                
                const titleLabel = img.previousElementSibling;
                if (titleLabel) {
                    titleLabel.innerHTML = `照片 ${index+1} <span style="color:#f39c12;">(已準備上傳)</span>`;
                }
            };
            reader.readAsDataURL(input.files[0]);
        }
    };

    window.removeLocalPreview = function(imgId, inputId, btnId) {
        const img = document.getElementById(imgId);
        const input = document.getElementById(inputId);
        const rmBtn = document.getElementById(btnId);
        
        input.value = "";
        
        img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="%23ccc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
        img.setAttribute('data-existing', '');
        
        if (rmBtn) rmBtn.style.display = 'none';
        
        const index = btnId.split('-').pop();
        const titleLabel = img.previousElementSibling;
        if (titleLabel) {
            titleLabel.innerHTML = `照片 ${parseInt(index)+1} <span style="color:red;">(必填)</span>`;
        }
    };

    window.viewAuditDetailOnly = function(safePointKey) {
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const currentRecords = window.auditLayersState[kmlId] || {};
        
        const originalKey = safePointKey.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'");
        const record = currentRecords[originalKey] || {};
        
        const status = escapeHtml(record.deviceStatus || '正常');
        const remark = escapeHtml(record.note || record.remark || '無');
        const existingPhotos = record.photos || [];

        let photosHtml = `<div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:15px; justify-content:center;">`;
        if (existingPhotos.length > 0) {
            existingPhotos.forEach((url, i) => {
                if (url) {
                    photosHtml += `
                        <div style="flex:1; min-width:45%; max-width:48%;">
                            <div style="text-align:center; margin-bottom:5px; font-weight:bold; font-size:13px;">照片 ${i+1}</div>
                            <a href="${url}" target="_blank">
                                <img src="${url}" style="width:100%; height:120px; object-fit:cover; border-radius:8px; border:1px solid #eee;">
                            </a>
                        </div>`;
                }
            });
        } else {
            photosHtml += `<div style="width:100%; text-align:center; color:#999; padding:20px 0;">尚無照片</div>`;
        }
        photosHtml += `</div>`;

        Swal.fire({
            title: '清查紀錄詳情',
            html: `
                <div style="text-align:left; font-size: 15px;">
                    <div style="margin-bottom: 10px; padding-bottom:5px; border-bottom:1px solid #eee;">
                        <b>點位名稱:</b> <span style="color:#e74c3c;">${safePointKey}</span>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <b>狀態:</b> <span style="color:#2980b9; font-weight:bold;">${status}</span>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <b>備註:</b> <span style="color:#555;">${remark}</span>
                    </div>
                    <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">
                    <b>現場照片:</b>
                    ${photosHtml}
                </div>
            `,
            showConfirmButton: true,
            confirmButtonText: '關閉',
            confirmButtonColor: '#3498db',
            width: '95%',
            customClass: { popup: 'mobile-swal-popup' }
        });
    };

    // ---------------------------------------------------------
    // 10. 初始化地圖面板與樣式
    // ---------------------------------------------------------
    document.addEventListener('DOMContentLoaded', () => {
        if (!document.getElementById('mobile-swal-style')) {
            const style = document.createElement('style');
            style.id = 'mobile-swal-style';
            style.innerHTML = `
                @media (max-width: 600px) {
                    .mobile-swal-popup { width: 95% !important; padding: 15px !important; border-radius: 12px !important; }
                    .mobile-swal-popup .swal2-title { font-size: 1.2rem !important; margin-bottom: 10px !important; }
                    .mobile-swal-popup .swal2-html-container { font-size: 0.95rem !important; }
                    .mobile-swal-popup .swal2-actions { margin-top: 15px !important; }
                    .mobile-swal-popup .swal2-confirm, .mobile-swal-popup .swal2-cancel { font-size: 1rem !important; padding: 10px 20px !important; }
                }
            `;
            document.head.appendChild(style);
        }
    });

    const initInterval = setInterval(() => {
        const ns = window.mapNamespace;
        if (ns && ns.map && typeof L !== 'undefined' && bottomControl === null) {
            bottomControl = L.control({ position: 'bottomright' });
            bottomControl.onAdd = function() {
                const div = L.DomUtil.create('div', 'audit-bottom-control');
                div.style.display = 'none';
                div.style.marginBottom = '60px';
                div.style.pointerEvents = 'auto';
                return div;
            };
            bottomControl.addTo(ns.map);
            initGlobalKmlConfigListener();
            clearInterval(initInterval);
        }
    }, 500);

})();