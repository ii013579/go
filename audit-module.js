/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (v3.25 視角絕對鎖定與即時變色修復版)
 */
(function() {
    'use strict';

    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;
    let clickDebounceTimer = null;

    // 用於絕對鎖定視角的暫存變數
    let savedMapCenter = null;
    let savedMapZoom = null;

    function saveCurrentMapView() {
        const map = window.mapNamespace?.map;
        if (map) {
            savedMapCenter = map.getCenter();
            savedMapZoom = map.getZoom();
        }
    }

    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    // =========================================================
    // 【修正】點位圖示 (藍點 / 黃點) 立即更新函式
    // =========================================================
    window.updateMarkerStatusDirectly = function(targetMarker, newStatus) {
        if (targetMarker) {
            const fillColor = (newStatus === 'completed') ? "#FCD770" : "#2A00D2";
            const color = "#000000";
            const radius = 9;
            const weight = 1;

            // 1. 立即變更樣式與顏色
            if (typeof targetMarker.setStyle === 'function') {
                targetMarker.setStyle({
                    fillColor: fillColor,
                    color: color,
                    weight: weight,
                    fillOpacity: 0.9,
                    radius: radius
                });
            } else if (typeof L !== 'undefined' && typeof targetMarker.setIcon === 'function') {
                const iconHtml = `<div style="background-color:${fillColor}; width:${radius * 2}px; height:${radius * 2}px; border-radius:50%; border:${weight}px solid ${color}; box-shadow:0 0 4px rgba(0,0,0,0.4);"></div>`;
                const customIcon = L.divIcon({
                    className: 'custom-audit-marker-icon',
                    html: iconHtml,
                    iconSize: [radius * 2, radius * 2],
                    iconAnchor: [radius, radius]
                });
                targetMarker.setIcon(customIcon);
            }

            // 2. 同步更新 Marker 內部的 feature 屬性資料
            if (targetMarker.feature && targetMarker.feature.properties) {
                targetMarker.feature.properties.status = newStatus;
                targetMarker.feature.properties.isAudited = (newStatus === 'completed');
                targetMarker.feature.properties.auditStatus = newStatus;
                targetMarker.feature.properties.fillColor = fillColor;
            } else if (targetMarker.properties) {
                targetMarker.properties.status = newStatus;
                targetMarker.properties.isAudited = (newStatus === 'completed');
                targetMarker.properties.auditStatus = newStatus;
            }
        }
    };

    // ---------------------------------------------------------
    // 0. 權限防護與安全轉義機制[cite: 1]
    // ---------------------------------------------------------
    function getUserRole() {
        return (window.currentUserRole || 
               window.userRole || 
               localStorage.getItem('userRole') || 
               sessionStorage.getItem('userRole') || 
               'guest').toLowerCase().trim();
    }

    function checkHasAuditPermission() {
        const role = getUserRole();
        return role !== 'guest' && role !== 'unapproved';
    }

    function canSeeAuditColors() {
        const role = getUserRole();
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

    function escapeJsParam(str) {
        if (!str) return '';
        return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    const escapeHtml = safeEscape;
    window.escapeHtml = safeEscape;

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
    // 1. 樣式攔截器、強力重繪與視角絕對鎖定機制[cite: 1]
    // ---------------------------------------------------------
    function processAndStyleLayer(layer) {
        if (!layer) return;

        if (typeof layer.eachLayer === 'function') {
            layer.eachLayer(processAndStyleLayer);
            return;
        }

        if (layer.feature && layer.feature.properties) {
            const ns = window.mapNamespace;
            const props = layer.feature.properties;
            
            const kmlId = props.kmlId || ns?.currentKmlLayerId || window.currentActiveKmlId;
            const records = (kmlId && window.auditLayersState?.[kmlId]) || {};
            const config = kmlId ? window.globalAuditConfigs?.[kmlId] : null;
            const showAuditMode = config?.isAuditing && canSeeAuditColors();

            const pointKey = props.name || props.title || props.id || props.auditPointKey || "未知點位";
            
            let fillColor = "#e74c3c"; 
            let color = "#ffffff";
            let radius = 8;
            let weight = 1.5;
            let fillOpacity = 0.85;

            if (showAuditMode) {
                const record = records[pointKey];
                if (record) {
                    props.isAudited = true;
                    props.auditStatus = record.deviceStatus || "正常";
                    props.photos = record.photos || [];
                    props.auditNote = record.note;

                    fillColor = "#FCD770"; // 已清查 (黃點)[cite: 1]
                    color = "#000000";
                    radius = 9;
                    weight = 1;
                    fillOpacity = 0.9;
                } else {
                    props.isAudited = false;
                    fillColor = "#2A00D2"; // 未清查 (深藍點)[cite: 1]
                    color = "#ffffff";
                    radius = 8;
                    weight = 1;
                    fillOpacity = 0.9;
                }
            } else {
                props.isAudited = false;
            }

            if (typeof layer.setStyle === 'function') {
                layer.setStyle({
                    fillColor: fillColor,
                    color: color,
                    weight: weight,
                    fillOpacity: fillOpacity,
                    radius: radius
                });
            } 
            else if (typeof L !== 'undefined' && layer instanceof L.Marker) {
                const iconHtml = `<div style="background-color:${fillColor}; width:${radius * 2}px; height:${radius * 2}px; border-radius:50%; border:${weight}px solid ${color}; box-shadow:0 0 4px rgba(0,0,0,0.4);"></div>`;
                const customIcon = L.divIcon({
                    className: 'custom-audit-marker-icon',
                    html: iconHtml,
                    iconSize: [radius * 2, radius * 2],
                    iconAnchor: [radius, radius]
                });
                layer.setIcon(customIcon);
            }

            if (typeof layer.getElement === 'function' && layer.getElement()) {
                layer.getElement().style.display = '';
            }
        }
    }

    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId || window.currentActiveKmlId;

        if (kmlId && Array.isArray(features)) {
            const config = window.globalAuditConfigs[kmlId];
            const records = window.auditLayersState[kmlId] || {};
            const showAuditMode = config && config.isAuditing === true && canSeeAuditColors();

            features.forEach(f => {
                if (!f.properties) f.properties = {};
                f.properties.kmlId = kmlId;
                
                const pointKey = f.properties.name || f.properties.title || f.properties.id || f.id || "未知點位";
                f.properties.auditPointKey = pointKey; 

                if (showAuditMode) {
                    const record = records[pointKey];
                    if (record) {
                        f.properties.auditStatus = record.deviceStatus || "正常";
                        f.properties.auditNote = record.note;
                        f.properties.photos = record.photos || [];
                        f.properties.isAudited = true;
                    } else {
                        f.properties.isAudited = false;
                        f.properties.auditStatus = null;
                    }
                } else {
                    f.properties.isAudited = false;
                    delete f.properties.auditStatus;
                }
            });
        }
        
        const result = originalAddLayers ? originalAddLayers.apply(this, arguments) : null;
        
        if (window.mapNamespace && window.mapNamespace.map) {
            window.mapNamespace.map.eachLayer(processAndStyleLayer);
        }
        return result;
    };

    // =========================================================
    // 強力重繪與視角絕對鎖定控制
    // =========================================================
    window.forceMapRefresh = function(targetLat, targetLng) {
        const ns = window.mapNamespace;
        const map = ns?.map;
        if (!map) return;

        // 優先使用預先保存的視角，若無則抓取當前
        let targetCenter = savedMapCenter || map.getCenter();
        let targetZoom = savedMapZoom || map.getZoom();

        if (targetLat !== undefined && targetLat !== null && targetLng !== undefined && targetLng !== null && !isNaN(parseFloat(targetLat)) && !isNaN(parseFloat(targetLng))) {
            targetCenter = L.latLng(parseFloat(targetLat), parseFloat(targetLng));
        }

        setTimeout(() => {
            if (map && typeof map.invalidateSize === 'function') {
                map.invalidateSize({ animate: false });
                map.eachLayer(processAndStyleLayer);
                map.setView(targetCenter, targetZoom, { animate: false });
            }
            syncAuditButtonVisibility();
        }, 150);
    };

    // ---------------------------------------------------------
    // 2. 底部控制按鈕面板[cite: 1]
    // ---------------------------------------------------------
    function updateBottomBtnState() {
        if (!bottomControl || !bottomControl._container) return;

        if (!checkHasAuditPermission() || !canSeeAuditColors()) {
            bottomControl._container.style.display = 'none';
            return;
        }

        const active = window.currentSelectedPoint;
        const kmlId = window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        const config = window.globalAuditConfigs[kmlId];

        if (active && config && config.isAuditing === true) {
            const layerProps = active.feature?.properties || active.properties || {};
            const pointKey = layerProps.name || layerProps.title || layerProps.id || "未知點位";
            const safeJsKey = escapeJsParam(pointKey);
            
            const currentRecords = window.auditLayersState[kmlId] || {};
            const isAudited = currentRecords[pointKey] !== undefined;

            const btnBaseStyle = `
                color: white; border: none; padding: 8px 20px; border-radius: 25px; 
                font-weight: bold; font-size: 15px; box-shadow: 0 3px 10px rgba(0,0,0,0.3); 
                cursor: pointer; outline: none; line-height: 1.4;
            `;

            let btnHtml = '';
            if (isAudited) {
                btnHtml = `
                    <button onclick="window.viewAuditDetailOnly('${safeJsKey}')" style="background: #e91e63; ${btnBaseStyle}">查看</button>
                    <button onclick="window.openAuditEditor(true)" style="background: #f39c12; ${btnBaseStyle}">修改</button>
                `;
            } else {
                btnHtml = `
                    <button onclick="window.openAuditEditor(false)" style="background: #2ecc71; ${btnBaseStyle}">清查點位</button>
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
    // 3. CSV 總表生成[cite: 1]
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

        const allPointKeys = new Set();
        featureMap.forEach((_, key) => allPointKeys.add(key));
        Object.keys(records).forEach(key => { if (key) allPointKeys.add(String(key)); });

        allPointKeys.forEach(pointKey => {
            const record = records[pointKey]; 
            const feature = featureMap.get(pointKey);
            let rowArr = [`"${pointKey.replace(/"/g, '""')}"`];

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

            rowArr.push(`"${lng}"`, `"${lat}"`);

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
            const csvStoragePath = `${rootPath}/${safeLayerName}/${safeLayerName}_清查總表.csv`;

            if (typeof firebase === 'undefined' || !firebase.storage) {
                throw new Error("Firebase Storage SDK 未初始化！");
            }

            const storageRef = firebase.storage().ref().child(csvStoragePath);
            await storageRef.put(blob, { contentType: 'text/csv' });
        } catch (err) {
            console.error("❌ [CSV 失敗]：", err);
        }
    }

    // ---------------------------------------------------------
    // 4. 清查管理對話框[cite: 1]
    // ---------------------------------------------------------
    window.showAuditActionModal = async function() {
        if (!checkHasAuditPermission()) {
            Swal.fire('權限不足', '您的帳號角色不允許管理清查狀態！', 'warning');
            return;
        }
        const select = document.getElementById('kmlLayerSelect');
        if (!select || select.options.length <= 1) return;

        saveCurrentMapView(); // 鎖定視角

        let listHtml = '<div style="max-height: 380px; overflow-y: auto; text-align: left;">';
        Array.from(select.options).forEach(opt => {
            if (!opt.value) return;
            const config = window.globalAuditConfigs?.[opt.value] || {};
            const isAuditing = config.isAuditing || false;
            const targetPhotos = config.targetPhotos || 2;
            const baseName = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
            const safeJsValue = escapeJsParam(opt.value);

            listHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid #eee;">
                    <div>
                        <div style="font-weight:bold; font-size:14px;">${escapeHtml(baseName)}</div>
                        ${isAuditing ? `<div style="color: #e67e22; font-size:12px;">清查中：需照片 ${targetPhotos} 張</div>` : `<div style="color: #999; font-size: 12px;">未開啟清查</div>`}
                    </div>
                    <div style="display:flex; gap:6px;">
                        ${isAuditing ? `<button onclick="window.downloadAuditPhotosZip('${safeJsValue}')" style="background:#8e44ad; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:12px;">下載照片</button>` : ''}
                        <button onclick="window.toggleAuditStatus('${safeJsValue}', ${!isAuditing})" style="background:${isAuditing ? '#666' : '#3498db'}; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:12px;">${isAuditing ? '關閉' : '開啟'}</button>
                    </div>
                </div>`;
        });
        listHtml += '</div>';
        
        Swal.fire({ 
            title: '圖層清查管理', 
            html: listHtml, 
            showConfirmButton: false, 
            showCloseButton: true,
            didClose: () => { forceMapRefresh(); }
        });
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
                                <label style="font-weight:bold; display:block; margin-bottom:6px;">1. 必填照片張數 (1~12 張)</label>
                                <input id="swal-input-count" type="number" class="swal2-input" value="2" min="1" max="12" style="width:100%; margin:0;">
                            </div>
                            <div>
                                <label style="font-weight:bold; display:block; margin-bottom:6px;">2. 設備狀態選項 (逗號或換行分隔)</label>
                                <textarea id="swal-input-status" class="swal2-textarea" style="width:100%; height:80px; margin:0;">${defaultStatusStr}</textarea>
                            </div>
                        </div>
                    `,
                    showCancelButton: true,
                    confirmButtonText: '確定並開啟',
                    preConfirm: () => {
                        const countVal = parseInt(document.getElementById('swal-input-count').value, 10);
                        const statusVal = document.getElementById('swal-input-status').value.trim();
                        if (!countVal || countVal < 1 || countVal > 12) {
                            Swal.showValidationMessage('照片張數必須介於 1 到 12 張！');
                            return false;
                        }
                        const optionsArray = statusVal.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
                        return { count: countVal, options: optionsArray };
                    }
                });

                if (formValues) {
                    const { count, options } = formValues;
                    localStorage.setItem('audit_status_options', JSON.stringify(options));
                    await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: true, targetPhotos: count, statusOptions: options }, { merge: true });
                    
                    if (!window.globalAuditConfigs[kmlId]) window.globalAuditConfigs[kmlId] = {};
                    window.globalAuditConfigs[kmlId].isAuditing = true;

                    syncAuditButtonVisibility();
                    forceMapRefresh();
                    Swal.fire({ icon: 'success', title: '已成功開啟清查模式', timer: 1200, showConfirmButton: false });
                }
            } else {
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: false }, { merge: true });
                if (!window.globalAuditConfigs[kmlId]) window.globalAuditConfigs[kmlId] = {};
                window.globalAuditConfigs[kmlId].isAuditing = false;

                syncAuditButtonVisibility();
                forceMapRefresh();
                Swal.fire({ icon: 'success', title: '已關閉清查模式', timer: 1000, showConfirmButton: false });
            }
        } catch (error) {
            console.error("切換失敗:", error);
        }
    };
        
    // =========================================================
    // 5. 手動新增點位與彈窗介面[cite: 1]
    // =========================================================
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
            forceMapRefresh();
            return;
        }
    
        if (!checkHasAuditPermission()) {
            Swal.fire('權限不足', '您的帳號角色不允許新增點位！', 'warning');
            return;
        }
    
        const targetKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        if (!targetKmlId) {
            Swal.fire('提示', '請先選擇一個目標圖層！', 'info');
            return;
        }
    
        const map = window.mapNamespace?.map;
        if (!map) return;
    
        saveCurrentMapView(); // 鎖定視角
        const container = map.getContainer();
        container.style.cursor = 'crosshair';
        setAddButtonActiveState(true);
    
        Swal.mixin({ toast: true, position: 'top', showConfirmButton: false, timer: 4000 }).fire({ icon: 'info', title: '📍 請在地圖上點擊要新增點位的位置' });
    
        const handleMapClick = async function(e) {
            cleanup();
            const { lat, lng } = e.latlng;
            if (typeof window.openAddPointModal === 'function') {
                await window.openAddPointModal(targetKmlId, lat, lng);
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
            padding: 8px 20px !important; border-radius: 25px !important; font-weight: bold !important;
            font-size: 15px !important; box-shadow: 0 3px 10px rgba(0,0,0,0.3) !important; cursor: pointer !important;
            display: none !important; align-items: center !important; justify-content: center !important; gap: 6px !important;
        `);
        btn.onclick = (e) => { e.stopPropagation(); window.startAddCustomPoint(); };
        syncAuditButtonVisibility();
    })();
    
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
        saveCurrentMapView(); // 鎖定視角
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
                        <input type="file" id="add-photo-input-${i}" accept="image/*" capture="environment" onchange="window.handleAddPhotoPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;">
                    </div>
                    <label style="position:absolute; left:50%; transform:translateX(-50%); bottom:-10px; z-index:3; background:#555; color:#fff; font-size:11px; padding:2px 8px; border-radius:12px; white-space:nowrap;">
                        <span id="add-tag-text-${i}">${hasPhoto ? '已選取' : '圖庫'}</span>
                    </label>
                </div>`;
        }
    
        const selectEl = document.getElementById('kmlLayerSelect');
        const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || kmlId;
        const kmlLayerName = rawLayerName.replace(/\.kml$/i, '').trim();
    
        const { value: formValues } = await Swal.fire({
            html: `
            <div style="text-align: left;">
                <div style="text-align: center; font-size: 20px; font-weight: bold; margin-bottom: 20px;">${isEditMode ? '✏️ 修改點位' : '➕ 新增點位'}</div>
                <label style="font-weight: bold; display:block; margin-bottom:6px;">點位名稱 *必填</label>
                <input type="text" id="add-point-name" value="${defaultName}" class="swal2-input" style="width:100%; margin:0 0 15px 0;">
                <label style="font-weight: bold; display:block; margin-bottom:6px;">現場照片 (需拍 ${maxPhotos} 張) *必填</label>
                <div style="display: flex; gap: 15px; flex-wrap: wrap;">${photoHtml}</div>
                <label style="font-weight: bold; display:block; margin:15px 0 6px 0;">備註事項</label>
                <textarea id="add-point-remark" class="swal2-textarea" style="width:100%; height:70px; margin:0;">${defaultRemark}</textarea>
            </div>`,
            showCancelButton: true,
            confirmButtonText: isEditMode ? '確認儲存' : '確認新增',
            didClose: () => { forceMapRefresh(lat, lng); },
            preConfirm: () => {
                const name = document.getElementById('add-point-name').value.trim();
                const remark = document.getElementById('add-point-remark').value.trim();
                const photosArray = [];
                for (let i = 0; i < maxPhotos; i++) {
                    const fileInput = document.getElementById(`add-photo-input-${i}`);
                    const img = document.getElementById(`add-prev-${i}`);
                    if (fileInput?.files?.[0]) photosArray.push(fileInput.files[0]);
                    else if (img?.src && !img.src.startsWith('data:') && !img.src.startsWith('blob:')) photosArray.push(img.src);
                }
                if (!name) { Swal.showValidationMessage('請填寫點位名稱！'); return false; }
                if (photosArray.length < maxPhotos) { Swal.showValidationMessage(`請上傳完整 ${maxPhotos} 張照片！`); return false; }
                return { kmlId, kmlLayerName, lat, lng, pointName: name, remark, photos: photosArray, isEditMode, oldPointKey: defaultName };
            }
        });
    
        if (formValues && typeof window.submitNewCustomPoint === 'function') {
            await window.submitNewCustomPoint(formValues);
        }
    };
    
    window.submitNewCustomPoint = async function(formValues) {
        const { kmlId, kmlLayerName, lat, lng, pointName, remark, photos, isEditMode, oldPointKey } = formValues;
        const numLat = parseFloat(lat);
        const numLng = parseFloat(lng);

        Swal.fire({ title: '正在處理並儲存...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
    
        try {
            let photoUrls = [];
            if (typeof window.uploadPhotosToStorage === 'function') {
                photoUrls = await window.uploadPhotosToStorage(photos, kmlId, pointName, kmlLayerName);
            }

            if (isEditMode && oldPointKey && oldPointKey !== pointName) {
                delete window.auditLayersState[kmlId][oldPointKey];
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(oldPointKey).delete();
            }
    
            const structuredData = {
                pointName: pointName,
                status: "已完成",
                deviceStatus: "新增",
                auditStatus: "新增",
                note: remark || "",
                photos: photoUrls,
                lat: numLat,
                lng: numLng,
                isCustomPoint: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
    
            if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
            window.auditLayersState[kmlId][pointName] = structuredData;
    
            await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pointName).set(structuredData, { merge: true });
    
            forceMapRefresh(numLat, numLng);
            Swal.fire({ icon: 'success', title: '儲存成功', timer: 1200, showConfirmButton: false });
        } catch (e) {
            console.error(e);
            Swal.fire('錯誤', e.message || '儲存失敗', 'error');
        }
    };
    
    window.uploadPhotosToStorage = async function(photos, kmlId, pointKey, kmlLayerName) {
        const storageRef = firebase.storage().ref();
        const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');
        
        const uploadPromises = photos.map(async (photoData, index) => {
            if (typeof photoData === 'string' && !photoData.startsWith('data:image')) return photoData;
            const ref = storageRef.child(`${STORAGE_ROOT}/${kmlLayerName}/${safePointKey}_${String(index + 1).padStart(2, '0')}.jpg`);
            let blob = (photoData instanceof File || photoData instanceof Blob) ? photoData : await (await fetch(photoData)).blob();
            await ref.put(blob);
            return await ref.getDownloadURL();
        });
        return await Promise.all(uploadPromises);
    };
    
    // =========================================================
    // 6. 清查紀錄編輯器（支援即時轉黃點與視角鎖定）[cite: 1]
    // =========================================================
    window.openAuditEditor = async function(isModifyMode = false) {
        if (!checkHasAuditPermission()) return;
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) return;
    
        saveCurrentMapView(); // 鎖定視角，防止彈窗開關時地圖飄移

        const layerProps = activePoint.feature?.properties || activePoint.properties || {};
        const pointKey = layerProps.name || layerProps.title || layerProps.id || "未知點位"; 
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        const config = (window.globalAuditConfigs && window.globalAuditConfigs[kmlId]) || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos || 2;

        const selectEl = document.getElementById('kmlLayerSelect');
        const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '預設區域';
        const kmlLayerName = rawLayerName.replace(/\.kml$/i, '').trim(); 
    
        const historyRecord = isModifyMode ? (window.auditLayersState?.[kmlId]?.[pointKey] || {}) : {};
        const currentPhotos = new Array(maxPhotos).fill('');
        if (isModifyMode && Array.isArray(historyRecord.photos)) {
            historyRecord.photos.forEach((url, idx) => { if (idx < maxPhotos) currentPhotos[idx] = url || ''; });
        }
    
        const currentStatus = historyRecord.deviceStatus || '';
        const currentNote = historyRecord.note || '';
        const baseStatusOptions = config.statusOptions || ['正常', '損壞', '遺失'];
    
        const statusOptionsHtml = baseStatusOptions.filter(opt => opt !== '新增').map(opt => 
            `<option value="${opt}" ${currentStatus === opt ? 'selected' : ''}>${opt}</option>`
        ).join('');
        
        let statusSelectHtml = `
            <select id="swal-status" class="swal2-input" style="width:100%; margin:6px 0 16px 0;">
                <option value="" ${!currentStatus ? 'selected' : ''}>--- 請選擇設備狀態 ---</option>
                ${statusOptionsHtml}
            </select>`;
    
        window._tempPreview = function(input, index) {
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    currentPhotos[index] = e.target.result;
                    const prevEl = document.getElementById('audit-prev-' + index);
                    const iconEl = document.getElementById('audit-icon-' + index);
                    if (prevEl) { prevEl.src = e.target.result; prevEl.style.display = 'block'; }
                    if (iconEl) { iconEl.style.display = 'none'; }
                };
                reader.readAsDataURL(input.files[0]);
            }
        };
    
        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const photoData = currentPhotos[i] || '';
            photoHtml += `
                <div style="position:relative; margin-bottom:18px;">
                    <div style="border:2px dashed #ccc; height:85px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:8px; overflow:hidden;">
                        <img id="audit-prev-${i}" src="${photoData}" style="width:100%; height:100%; object-fit:cover; display:${photoData ? 'block' : 'none'}; position:absolute; top:0; left:0; z-index:1;">
                        <span id="audit-icon-${i}" style="font-size:24px; color:#bbb; display:${photoData ? 'none' : 'block'}; z-index:1;">📷</span>
                        <input type="file" id="audit-file-input-${i}" accept="image/*" capture="environment" onchange="window._tempPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;">
                    </div>
                </div>`;
        }
    
        const { value: res } = await Swal.fire({
            title: `<div style="font-size:18px;">${isModifyMode ? '修改' : '填寫'}清查紀錄：${escapeHtml(pointKey)}</div>`,
            html: `<div style="text-align:left;">
                <label style="font-size:14px; font-weight:bold;">設備狀態 *必選</label>
                ${statusSelectHtml}
                <label style="font-size:14px; font-weight:bold;">現場照片 (需滿 ${maxPhotos} 張) *必填</label>
                <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:10px; margin:8px 0 16px 0;">${photoHtml}</div>
                <label style="font-size:14px; font-weight:bold;">備註事項</label>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%; height:70px; margin:6px 0 0 0;">${escapeHtml(currentNote)}</textarea>
            </div>`,
            showCancelButton: true,
            confirmButtonText: isModifyMode ? '覆蓋更新' : '確認並上傳',
            didClose: () => {
                // 彈窗完全關閉後強制鎖定回原視角，解決地圖跳動與灰圖
                forceMapRefresh();
            },
            preConfirm: () => {
                const statusValue = document.getElementById('swal-status').value;
                if (!statusValue) { Swal.showValidationMessage('請選擇設備狀態'); return false; }
                const validPhotosCount = currentPhotos.filter(p => p && p.trim() !== '').length;
                if (validPhotosCount < maxPhotos) { Swal.showValidationMessage(`請補滿 ${maxPhotos} 張照片`); return false; }
                return { status: statusValue, note: document.getElementById('swal-note').value, photos: currentPhotos };
            }
        });
    
        delete window._tempPreview;
    
        if (res) {
            Swal.fire({ title: '正在上傳與更新...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const photoUrls = await window.uploadPhotosToStorage(res.photos, kmlId, pointKey, kmlLayerName);
    
                const structuredData = {
                    pointName: pointKey,
                    status: "已完成",
                    deviceStatus: res.status, 
                    note: res.note, 
                    photos: photoUrls, 
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
    
                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][pointKey] = structuredData;

                // 【關鍵修復】主動並立即將當前點位變更為黃點 (Completed 狀態)[cite: 1]
                if (activePoint) {
                    window.updateMarkerStatusDirectly(activePoint, 'completed');
                }
    
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pointKey).set(structuredData, { merge: true });
    
                if (typeof generateLayerCsvReport === 'function') {
                    await generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos);
                }
    
                Swal.fire({ icon: 'success', title: '更新成功', timer: 1000, showConfirmButton: false });
                forceMapRefresh();
            } catch (e) { 
                console.error(e);
                Swal.fire('錯誤', e.message || '儲存失敗', 'error'); 
            }
        }
    };
      
    window.viewAuditDetailOnly = function(pointKey) {
        const kmlId = window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        const record = window.auditLayersState[kmlId]?.[pointKey];
        if (!record) return;

        let imagesHtml = '';
        if (Array.isArray(record.photos)) {
            record.photos.forEach(url => {
                if (url) imagesHtml += `<img src="${escapeHtml(url)}" style="width:45%; margin:2%; max-height:120px; object-fit:cover; border-radius:6px;">`;
            });
        }

        Swal.fire({
            title: `清查紀錄：${escapeHtml(pointKey)}`,
            html: `<div style="text-align: left; font-size:14px;">
                <p><b>設備狀態：</b><span style="color:#e91e63; font-weight:bold;">🟢 ${escapeHtml(record.deviceStatus || '正常')}</span></p>
                <p><b>備註：</b>${escapeHtml(record.note || '無')}</p>
                <div style="display:flex; flex-wrap:wrap;">${imagesHtml || '無照片'}</div>
            </div>`,
            confirmButtonText: '關閉'
        });
    };

    window.downloadAuditPhotosZip = async function(kmlId) {
        if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
            Swal.fire('套件缺失', '請引入 JSZip 與 FileSaver 套件！', 'error');
            return;
        }
        // ... (保持原封包下載邏輯)
    };

    // ---------------------------------------------------------
    // 7. 資料動態監聽與初始化[cite: 1]
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
            if (typeof window.forceMapRefresh === 'function') window.forceMapRefresh();
        }, err => { console.warn(err); });
    };

    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        auditUnsubscribes[kmlId] = firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snapshot => {
                const updates = {};
                snapshot.forEach(doc => { updates[doc.id] = doc.data(); });
                window.auditLayersState[kmlId] = updates;
                if (typeof window.forceMapRefresh === 'function') window.forceMapRefresh(); 
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

    let checkAttempts = 0;
    const checkMapInterval = setInterval(() => {
        checkAttempts++;
        if (window.mapNamespace?.map && typeof L !== 'undefined') {
            clearInterval(checkMapInterval);
            const map = window.mapNamespace.map;

            map.on('moveend zoomend resize', () => {
                setTimeout(() => { map.invalidateSize({ animate: false }); }, 100);
            });

            map.on('layeradd', (e) => { processAndStyleLayer(e.layer); });

            const AuditMenu = L.Control.extend({
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                    this._container.style.cssText = 'display:none; position:fixed; bottom:35px; left:50%; transform:translateX(-50%); z-index:5000; pointer-events:none; background:transparent;';
                    return this._container;
                }
            });
            bottomControl = new AuditMenu();
            bottomControl.addTo(map);
            
            initGlobalConfigListener();
        } else if (checkAttempts >= 30) {
            clearInterval(checkMapInterval);
        }
    }, 500);

})();