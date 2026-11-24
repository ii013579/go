/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (v3.57 效能優化與 ZIP 整合 CSV 版)
 */
(function() {
    'use strict';

    // ---------------------------------------------------------
    // 0. 全域狀態與環境初始化
    // ---------------------------------------------------------
    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = window.globalAuditConfigs || {}; 
    window.showAuditedPoints = window.showAuditedPoints ?? true;

    const auditUnsubscribes = {};
    let bottomControl = null, yellowDotControl = null, progressControl = null;
    let clickDebounceTimer = null, activeAddPointCleanup = null;

    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    // 全域安全轉義工具
    function safeEscape(str) {
        if (str == null) return '';
        if (typeof str !== 'string') str = String(str);
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
    window.safeEscape = safeEscape;
    window.escapeHtml = safeEscape;

    function getUserRole() {
        try {
            return (window.currentUserData?.role || window.currentUserRole || window.userRole || 
                    localStorage.getItem('userRole') || sessionStorage.getItem('userRole') || 'guest')
                    .toString().trim().toLowerCase();
        } catch {
            return 'guest';
        }
    }

    function checkHasAuditPermission() {
        const role = getUserRole();
        return !['unapproved', 'guest', 'blocked'].includes(role);
    }

    function isAuditActiveForLayer(kmlId) {
        if (!checkHasAuditPermission()) return false;
        const config = getSafeAuditConfig(kmlId);
        return !!config?.isAuditing;
    }

    function getPointKey(props, defaultVal = "未知點位") {
        return props?.name || props?.title || props?.auditPointKey || props?.id || defaultVal;
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

    function getSafeAuditConfig(kmlId) {
        const id = kmlId || window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId || 'default_kml';
        return window.globalAuditConfigs[id] ||= { isAuditing: false, targetPhotos: 2, statusOptions: ['正常', '損壞', '遺失'] };
    }

    function syncAuditButtonVisibility() {
        const kmlId = window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        setPointAddBtnVisible(isAuditActiveForLayer(kmlId));
    }
    window.syncAuditButtonVisibility = syncAuditButtonVisibility;

    // ---------------------------------------------------------
    // 📊 清查進度計算與未清查清單
    // ---------------------------------------------------------
    window.getAuditProgress = function() {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId || window.currentActiveKmlId;
        if (!kmlId || !isAuditActiveForLayer(kmlId)) return null;

        const records = window.auditLayersState?.[kmlId] || {};
        const features = ns?.allKmlFeatures || [];
        const pointFeatures = features.filter(f => !f.geometry || f.geometry.type === 'Point');
        
        if (!pointFeatures.length) return null;

        const auditedCount = pointFeatures.filter(f => records[getPointKey(f.properties, f.id)]).length;
        const remainingCount = pointFeatures.length - auditedCount;

        return { audited: auditedCount, remaining: remainingCount, total: pointFeatures.length, text: `未清查: ${remainingCount} / ${pointFeatures.length}` };
    };

    window.getUnauditedPoints = function() {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId || window.currentActiveKmlId;
        if (!kmlId || !isAuditActiveForLayer(kmlId)) return [];

        const records = window.auditLayersState?.[kmlId] || {};
        const features = ns?.allKmlFeatures || [];
        const pointFeatures = features.filter(f => !f.geometry || f.geometry.type === 'Point');

        return pointFeatures
            .filter(f => !records[getPointKey(f.properties, f.id)])
            .map(f => {
                const key = getPointKey(f.properties, f.id);
                const coords = f.geometry?.coordinates || [];
                return {
                    key,
                    lng: parseFloat(coords[0]),
                    lat: parseFloat(coords[1])
                };
            });
    };

    window.focusUnauditedPoint = function(pointKey, lat, lng) {
        Swal.close();
        const ns = window.mapNamespace;
        const map = ns?.map;
        const numLat = parseFloat(lat);
        const numLng = parseFloat(lng);

        if (map && !isNaN(numLat) && !isNaN(numLng)) {
            const targetZoom = typeof map.getZoom === 'function' ? map.getZoom() : undefined;
            map.setView([numLat, numLng], targetZoom, { animate: true });

            let matchedLayer = null;
            map.eachLayer(layer => {
                if (matchedLayer) return;
                const props = layer.feature?.properties || layer.options?.properties;
                if (props && getPointKey(props, '') === pointKey) {
                    matchedLayer = layer;
                }
            });

            if (matchedLayer) {
                window.currentSelectedPoint = matchedLayer;
                if (typeof matchedLayer.fire === 'function') {
                    matchedLayer.fire('click', { latlng: L.latLng(numLat, numLng), target: matchedLayer });
                }
            } else {
                window.currentSelectedPoint = {
                    properties: {
                        name: pointKey,
                        title: pointKey,
                        auditPointKey: pointKey,
                        kmlId: ns?.currentKmlLayerId || window.currentActiveKmlId
                    }
                };
            }

            setTimeout(updateBottomBtnState, 160);
        }
    };

    window.showUnauditedPointsList = function() {
        const unaudited = window.getUnauditedPoints();

        if (!unaudited.length) {
            return Swal.fire({
                icon: 'success',
                title: '太棒了！目前沒有未清查點位',
                text: '此圖層的所有點位都已完成清查。',
                timer: 1500,
                showConfirmButton: false
            });
        }

        const listHtml = `
            <div style="max-height: 60vh; overflow-y: auto; text-align: left; display: flex; flex-direction: column; gap: 6px; padding-right: 4px;">
                ${unaudited.map((pt, idx) => {
                    const safeKey = safeEscape(pt.key);
                    const hasCoords = !isNaN(pt.lat) && !isNaN(pt.lng);
                    return `
                        <button type="button"
                            ${hasCoords ? `onclick="window.focusUnauditedPoint('${safeKey}', ${pt.lat}, ${pt.lng})"` : 'disabled'}
                            style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:8px 12px; border:1px solid #e2e8f0; border-radius:6px; background:#f8fafc; color:#1e293b; font-size:14px; cursor:${hasCoords ? 'pointer' : 'default'}; text-align:left;">
                            <span><strong>${idx + 1}.</strong> ${safeKey}</span>
                            <span style="font-size:12px; color:#64748b;">${hasCoords ? '📍 定位' : '無座標'}</span>
                        </button>`;
                }).join('')}
            </div>`;

        Swal.fire({
            title: `未清查點位清單 (${unaudited.length} 筆)`,
            html: listHtml,
            showConfirmButton: false,
            showCloseButton: true,
            width: '480px',
            didOpen: () => typeof setPointAddBtnVisible === 'function' && setPointAddBtnVisible(false),
            willClose: () => typeof syncAuditButtonVisibility === 'function' && syncAuditButtonVisibility()
        });
    };

    // ---------------------------------------------------------
    // 🟡 已清查黃點顯示開關 (含點位文字標籤一併隱藏)
    // ---------------------------------------------------------
    window.toggleAuditedPointsVisibility = function() {
        window.showAuditedPoints = !window.showAuditedPoints;

        forceMapRefresh();
        updateBottomBtnState();

        const ns = window.mapNamespace;
        const map = ns?.map;
        const kmlId = ns?.currentKmlLayerId || window.currentActiveKmlId;
        const activeAudit = typeof isAuditActiveForLayer === 'function' ? isAuditActiveForLayer(kmlId) : true;
        const isAuditedVisible = window.showAuditedPoints !== false;

        if (activeAudit && Array.isArray(ns?.allKmlFeatures)) {
            const records = window.auditLayersState?.[kmlId] || {};
            ns.allKmlFeatures.forEach((f) => {
                if (f?.geometry?.type !== 'Point') return;
                const coords = f.geometry.coordinates;
                if (!Array.isArray(coords) || coords.length < 2) return;

                const pointKey = typeof getPointKey === 'function' ? getPointKey(f.properties, f.id) : (f.properties?.name || f.properties?.title || f.id);
                const isAudited = Boolean(records?.[pointKey] || f.properties?.isAudited);
                if (!isAudited) return;

                const labelId = `label-${String(coords[1])}-${String(coords[0])}`.replace(/\./g, '_');
                const spanEl = document.getElementById(labelId);
                const markerWrapEl = spanEl?.closest('.marker-label');
                const targetEl = markerWrapEl || spanEl;
                if (targetEl) {
                    targetEl.style.display = isAuditedVisible ? '' : 'none';
                }
            });
        }

        if (map && typeof map.eachLayer === 'function') {
            map.eachLayer((layer) => {
                const props = layer?.feature?.properties || layer?.options?.properties;
                if (!props?.isAudited) return;
                const iconEl = typeof layer.getElement === 'function' ? layer.getElement() : null;
                if (iconEl) {
                    iconEl.style.display = isAuditedVisible ? '' : 'none';
                }
            });
        }
    };


    // ---------------------------------------------------------
    // 1. 樣式攔截與重繪
    // ---------------------------------------------------------
    (function hookAddGeoJsonLayers() {
        if (window.addGeoJsonLayers && window.addGeoJsonLayers.__isHooked) return;

        const originalAddLayers = window.addGeoJsonLayers;

        const newAddGeoJsonLayers = function(features) {
            const ns = window.mapNamespace;
            const kmlId = ns?.currentKmlLayerId || window.currentActiveKmlId;

            let processingFeatures = Array.isArray(features) ? [...features] : features;

            if (kmlId && Array.isArray(processingFeatures)) {
                const records = window.auditLayersState?.[kmlId] || {};
                const activeAudit = isAuditActiveForLayer(kmlId);

                if (activeAudit) {
                    Object.entries(records).forEach(([key, record]) => {
                        if ((record.isCustomPoint || record.deviceStatus === "新增") && record.lat && record.lng) {
                            const pointKey = record.pointName || key;
                            if (!processingFeatures.some(f => getPointKey(f.properties, f.id) === pointKey)) {
                                processingFeatures.push({
                                    type: "Feature",
                                    geometry: { type: "Point", coordinates: [parseFloat(record.lng), parseFloat(record.lat)] },
                                    properties: {
                                        name: pointKey, title: pointKey, kmlId, auditPointKey: pointKey,
                                        isCustomPoint: true, isAudited: true, deviceStatus: record.deviceStatus || "新增",
                                        auditStatus: record.auditStatus || record.deviceStatus || "新增",
                                        auditNote: record.note || "", photos: record.photos || []
                                    }
                                });
                            }
                        }
                    });
                }

                const isAuditedVisible = window.showAuditedPoints !== false;

                processingFeatures.forEach(f => {
                    f.properties ||= {};
                    f.properties.kmlId = kmlId;
                    const pointKey = getPointKey(f.properties, f.id);
                    f.properties.auditPointKey = pointKey;

                    if (activeAudit) {
                        const record = records[pointKey];
                        const isAudited = !!record;
                        f.properties.isAudited = isAudited;

                        if (isAudited) {
                            const status = record.deviceStatus || "正常";
                            const isAlertStatus = (status === "損壞" || status === "遺失");
                            const pointColor = isAlertStatus ? "#F39C12" : "#FCD770"; // 損壞、遺失顯示橘色，其餘維持黃色

                            f.properties.auditStatus = status;
                            f.properties.fillColor = isAuditedVisible ? pointColor : "transparent";
                            f.properties.fillOpacity = isAuditedVisible ? 0.85 : 0;
                            f.properties.opacity = isAuditedVisible ? 1 : 0;
                            f.properties.stroke = isAuditedVisible;
                            f.properties.weight = isAuditedVisible ? 2 : 0;
                            f.properties.color = isAuditedVisible ? "#ffffff" : "transparent"; 
                        } else {
                            f.properties.auditStatus = null;
                            f.properties.fillColor = "#000000"; // 未清查點維持純黑
                            f.properties.fillOpacity = 0.85;
                            f.properties.opacity = 1;
                            f.properties.stroke = true;
                            f.properties.weight = 2;
                            f.properties.color = "#ffffff"; 
                        }
                        f.properties.radius = 8;
                    } else {
                        f.properties.fillColor = "#e74c3c";
                        f.properties.color = "#ffffff";
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
            
            const result = originalAddLayers ? originalAddLayers.call(this, processingFeatures) : null;

            if (ns?.map) {
                const activeAudit = isAuditActiveForLayer(kmlId);
                const isAuditedVisible = window.showAuditedPoints !== false;

                ns.map.eachLayer(layer => {
                    const props = layer.feature?.properties || layer.options?.properties;
                    if (!props) return;

                    if (!activeAudit) {
                        if (typeof layer.setStyle === 'function') {
                            layer.setStyle({ fillColor: "#e74c3c", color: "#ffffff", fillOpacity: 0.85, opacity: 1, stroke: true, weight: 1.5 });
                        }
                        return;
                    }

                    if (props.isAudited) {
                        layer.options.interactive = isAuditedVisible;
                        const isAlertStatus = (props.auditStatus === "損壞" || props.auditStatus === "遺失");
                        const pointColor = isAlertStatus ? "#F39C12" : "#FCD770"; // 損壞、遺失顯示橘色，其餘維持黃色

                        if (typeof layer.setStyle === 'function') {
                            layer.setStyle({
                                fillColor: isAuditedVisible ? pointColor : "transparent",
                                fillOpacity: isAuditedVisible ? 0.85 : 0,
                                opacity: isAuditedVisible ? 1 : 0,
                                stroke: isAuditedVisible,
                                weight: isAuditedVisible ? 2 : 0,
                                color: isAuditedVisible ? "#ffffff" : "transparent"
                            });
                        }
                    } else {
                        layer.options.interactive = true;
                        if (typeof layer.setStyle === 'function') {
                            layer.setStyle({
                                fillColor: "#000000", // 未清查點維持純黑
                                fillOpacity: 0.85,
                                opacity: 1,
                                stroke: true,
                                weight: 2,
                                color: "#ffffff"
                            });
                        }
                    }
                });
            }

            return result;
        };

        newAddGeoJsonLayers.__isHooked = true;
        window.addGeoJsonLayers = newAddGeoJsonLayers;
    })();

    function syncSelectedPointLayer(map) {
        const currentSelected = window.currentSelectedPoint;
        if (!currentSelected || !map) return;

        const selectedProps = currentSelected.feature?.properties || currentSelected.properties || {};
        const targetKey = getPointKey(selectedProps, '');
        if (!targetKey) return;

        let matchedLayer = null;
        map.eachLayer(layer => {
            if (matchedLayer) return;
            const props = layer.feature?.properties || layer.options?.properties;
            if (props && getPointKey(props, '') === targetKey) {
                matchedLayer = layer;
            }
        });

        if (matchedLayer) {
            window.currentSelectedPoint = matchedLayer;
        }
    }

    function initMapResizeObserver() {
        const map = window.mapNamespace?.map;
        if (map && !window._mapResizeObserver) {
            window._mapResizeObserver = new ResizeObserver(() => {
                try { map.invalidateSize({ pan: false }); } catch {}
            });
            window._mapResizeObserver.observe(map.getContainer());
        }
    }

    function forceMapRefresh() {
        const ns = window.mapNamespace;
        const map = ns?.map;
        const kmlId = ns?.currentKmlLayerId || window.currentActiveKmlId;
        if (!map || !kmlId) return;

        initMapResizeObserver();
        try { map.invalidateSize({ pan: false }); } catch {}

        if (typeof window.addGeoJsonLayers === 'function' && ns.allKmlFeatures) {
            window.addGeoJsonLayers(ns.allKmlFeatures);
        }

        syncSelectedPointLayer(map);
        syncAuditButtonVisibility();
        updateBottomBtnState();

        setTimeout(() => {
            try { map.invalidateSize({ pan: false }); } catch {}
        }, 150);
    }
    window.forceMapRefresh = forceMapRefresh;
    
    // ---------------------------------------------------------
    // 2. 底部控制按鈕與元件
    // ---------------------------------------------------------
    function updateBottomBtnState() {
        const kmlId = window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        const activeAudit = isAuditActiveForLayer(kmlId);

        if (!activeAudit) {
            if (bottomControl?._container) bottomControl._container.style.display = 'none';
            if (yellowDotControl?._container) yellowDotControl._container.style.display = 'none';
            if (progressControl?._container) progressControl._container.style.display = 'none';
            setPointAddBtnVisible(false);
            return;
        }

        if (yellowDotControl?._container) {
            const isAuditedVisible = window.showAuditedPoints !== false;
            yellowDotControl._container.style.display = 'block';
            yellowDotControl._container.innerHTML = `
                <button onclick="window.toggleAuditedPointsVisibility()" title="${isAuditedVisible ? '隱藏已清查黃點' : '顯示已清查黃點'}" class="audit-yellow-dot-btn">
                    <span class="audit-yellow-dot-icon-outer">
                        <span class="audit-yellow-dot-icon-inner"></span>
                    </span>
                    ${!isAuditedVisible ? '<span class="audit-yellow-dot-off-badge">❌</span>' : ''}
                </button>`;
        }

        if (progressControl?._container) {
            const progress = window.getAuditProgress();
            if (progress) {
                progressControl._container.style.display = 'block';
                progressControl._container.innerHTML = `
                    <button type="button" onclick="window.showUnauditedPointsList()" title="點擊查看未清查點位清單" class="audit-progress-card" style="cursor:pointer; border:none;">
                        未清查: ${progress.remaining} / ${progress.total}
                    </button>`;
            } else {
                progressControl._container.style.display = 'none';
            }
        }
        
        if (bottomControl?._container) {
            const active = window.currentSelectedPoint;
            if (active) {
                const layerProps = active.feature?.properties || active.properties || {};
                const pointKey = getPointKey(layerProps);
                const safePointKey = safeEscape(pointKey);
                const isAudited = (window.auditLayersState[kmlId] || {})[pointKey] !== undefined;

                const btnHtml = isAudited ? `
                    <button onclick="window.viewAuditDetailOnly('${safePointKey}')" class="audit-btn-action btn-view">🔍 查看</button>
                    <button onclick="window.openAuditEditor(true)" class="audit-btn-action btn-edit">✏ 修改</button>
                ` : `
                    <button onclick="window.openAuditEditor(false)" class="audit-btn-action btn-audit">📋 清查點位</button>
                `;

                bottomControl._container.style.display = 'block';
                bottomControl._container.innerHTML = `<div class="audit-bottom-action-bar">${btnHtml}</div>`;
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
    // 3. CSV 報告生成構建器 (獨立模組，強制 UTC+8 台灣時間)
    // ---------------------------------------------------------
    function buildCsvContent(kmlId, kmlLayerName, maxPhotos) {
        const activeKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        const records = window.auditLayersState?.[activeKmlId] || {};
        const features = window.mapNamespace?.allKmlFeatures || [];

        const getCleanPhotoName = (url) => {
            if (!url) return "";
            try {
                return (decodeURIComponent(String(url)).split("?")[0].split("/").pop() || "").replace(/\.[^/.]+$/, "").replace(/"/g, '""');
            } catch {
                return String(url).replace(/"/g, '""');
            }
        };

        const photoCount = parseInt(maxPhotos, 10) || 2;
        let headerArr = ["點名", "經度", "緯度", "設備狀態", "敘述"];
        for (let i = 1; i <= photoCount; i++) headerArr.push(`照片${i}`);
        headerArr.push("備註");
        headerArr.push("清查時間");
        
        let csvContent = "\uFEFF" + headerArr.join(",") + "\n";
        const featureMap = new Map();

        if (Array.isArray(features)) {
            features.forEach(f => {
                const key = getPointKey(f.properties, f.id);
                if (key) featureMap.set(String(key), f);
            });
        }

        new Set([...featureMap.keys(), ...Object.keys(records)]).forEach(pointKey => {
            if (!pointKey) return;
            const record = records[pointKey]; 
            const feature = featureMap.get(pointKey);
            let rowArr = [`"${String(pointKey).replace(/"/g, '""')}"`];

            rowArr.push(`"${record?.lng ?? feature?.geometry?.coordinates?.[0] ?? ""}"`);
            rowArr.push(`"${record?.lat ?? feature?.geometry?.coordinates?.[1] ?? ""}"`);

            const pointDesc = record?.description || record?.desc || "";

            let formattedTime = "";
            if (record?.updatedAt) {
                try {
                    const dateObj = record.updatedAt.toDate ? record.updatedAt.toDate() : new Date(record.updatedAt);
                    if (!isNaN(dateObj.getTime())) {
                        formattedTime = dateObj.toLocaleString('sv', { timeZone: 'Asia/Taipei' });
                    }
                } catch {
                    formattedTime = "";
                }
            }

            if (record) {
                rowArr.push(`"${String(record.deviceStatus || record.status || '正常').replace(/"/g, '""')}"`);
                rowArr.push(`"${String(pointDesc).replace(/"/g, '""')}"`);
                for (let i = 0; i < photoCount; i++) rowArr.push(`"${getCleanPhotoName(record.photos?.[i])}"`);
                rowArr.push(`"${String(record.remark || record.note || "").replace(/"/g, '""')}"`);
                rowArr.push(`"${formattedTime}"`);
            } else {
                rowArr.push('""');
                rowArr.push('""');
                for (let i = 0; i < photoCount; i++) rowArr.push('""');
                rowArr.push('""');
                rowArr.push('""');
            }
            csvContent += rowArr.join(",") + "\n";
        });

        return csvContent;
    }

    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos) {
        const csvContent = buildCsvContent(kmlId, kmlLayerName, maxPhotos);
        try {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
            const safeLayerName = kmlLayerName || 'default_layer';
            if (!firebase?.storage) throw new Error("Firebase Storage SDK 未初始化");

            return await firebase.storage().ref().child(`${STORAGE_ROOT}/${safeLayerName}/${safeLayerName}_清查總表.csv`).put(blob, { contentType: 'text/csv' });
        } catch {
            window.downloadCsvFallback?.(csvContent, `${kmlLayerName || '清查'}_總表.csv`);
        }
    }

    window.downloadCsvFallback = function(csvData, filename) {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([csvData], { type: 'text/csv;charset=utf-8;' }));
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // ---------------------------------------------------------
    // 4-1. 清查管理對話框與開關
    // ---------------------------------------------------------
    window.showAuditActionModal = async function() {
        if (!checkHasAuditPermission()) {
            return Swal.fire('權限不足', '您的帳號角色不允許管理清查狀態！', 'warning');
        }
        const select = document.getElementById('kmlLayerSelect');
        
        let listHtml = '<div class="audit-action-list">';

        if (select && select.options.length > 1) {
            Array.from(select.options).forEach(opt => {
                if (!opt.value) return;
                const config = getSafeAuditConfig(opt.value);
                const isAuditing = !!config.isAuditing;
                const targetPhotos = config.targetPhotos || 2;
                const baseName = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
                const safeValue = safeEscape(opt.value);

                listHtml += `
                    <div class="audit-action-item">
                        <div>
                            <div class="audit-action-title">${safeEscape(baseName)}</div>
                            ${isAuditing ? `<div class="audit-action-subtext-active">清查中：需照片 ${targetPhotos} 張</div>` : `<div class="audit-action-subtext-inactive">未開啟清查</div>`}
                        </div>
                        <div class="audit-btn-group">
                            ${isAuditing ? `<button onclick="window.downloadAuditPhotosZip('${safeValue}')" class="audit-btn-small audit-btn-zip">📦 下載照片</button>` : ''}
                            <button onclick="window.toggleAuditStatus('${safeValue}', ${!isAuditing})" class="audit-btn-small ${isAuditing ? 'audit-btn-toggle-on' : 'audit-btn-toggle-off'}">
                                ${isAuditing ? '關閉' : '開啟'}
                            </button>
                        </div>
                    </div>`;
            });
        } else {
            listHtml += `<div style="text-align: center; color: #7f8c8d; padding: 15px;">目前尚無任何圖層，請點擊左上角橘色按鈕建立空白圖層！</div>`;
        }
        listHtml += '</div>';
        
        Swal.fire({
            title: `
                <div style="display: flex; justify-content: space-between; align-items: center; position: relative; width: 100%;">
                    <button onclick="window.promptCreateEmptyLayer()" title="建立空白清查圖層" style="position: absolute; left: 0; background-color: #f39c12; color: white; width: 24px; height: 24px; border-radius: 4px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: bold; line-height: 1; padding: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">
                        +
                    </button>
                    <span style="flex-grow: 1; text-align: center;">圖層清查管理</span>
                </div>
            `,
            html: listHtml,
            showConfirmButton: false,
            showCloseButton: true,
            width: '600px',
            didOpen: () => {
                const closeBtn = document.querySelector('.swal2-close');
                if (closeBtn) closeBtn.style.top = '10px';
            }
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
                        <div class="audit-form-container">
                            <div class="audit-form-group">
                                <label class="audit-form-label">1. 設定必填照片張數 (1~12 張)</label>
                                <input id="swal-input-count" type="number" class="swal2-input audit-form-input" value="2" min="1" max="12" step="1">
                            </div>
                            <div>
                                <label class="audit-form-label">2. 設定設備狀態選項 (用逗號或換行分隔)</label>
                                <textarea id="swal-input-status" class="swal2-textarea audit-form-textarea">${defaultStatusStr}</textarea>
                            </div>
                        </div>`,
                    showCancelButton: true,
                    confirmButtonText: '確定並開啟清查',
                    cancelButtonText: '取消',
                    focusConfirm: false,
                    preConfirm: () => {
                        const countVal = parseInt(document.getElementById('swal-input-count').value, 10);
                        const statusVal = document.getElementById('swal-input-status').value.trim();

                        if (!countVal || countVal < 1 || countVal > 12) {
                            Swal.showValidationMessage('照片張數必須介於 1 到 12 張之間！');
                            return false;
                        }
                        const optionsArray = statusVal.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
                        if (!optionsArray.length) {
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
                    
                    window.globalAuditConfigs ||= {};
                    window.globalAuditConfigs[kmlId] = {
                        ...window.globalAuditConfigs[kmlId],
                        isAuditing: true,
                        targetPhotos: formValues.count,
                        statusOptions: formValues.options
                    };

                    forceMapRefresh();
                    Swal.fire({ icon: 'success', title: '已成功開啟清查模式', timer: 1200, showConfirmButton: false });
                } else {
                    window.showAuditActionModal();
                }
            } else {
                Swal.fire({ title: '正在關閉清查...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: false }, { merge: true });
                
                window.globalAuditConfigs ||= {};
                window.globalAuditConfigs[kmlId] = {
                    ...window.globalAuditConfigs[kmlId],
                    isAuditing: false
                };

                forceMapRefresh();
                Swal.fire({ icon: 'success', title: '已關閉清查模式', timer: 1000, showConfirmButton: false });
            }
        } catch (error) {
            Swal.fire({ icon: 'error', title: '同步失敗', text: error.message }).then(() => window.showAuditActionModal());
        }
    };

    // ---------------------------------------------------------
    // 4-2. 建立空白清查圖層功能
    // ---------------------------------------------------------
    window.promptCreateEmptyLayer = async function() {
        const savedOptions = localStorage.getItem('audit_status_options');
        const defaultStatusStr = savedOptions ? JSON.parse(savedOptions).join(', ') : '正常, 損壞, 遺失';

        const { value: formValues } = await Swal.fire({
            title: '📂 建立空白清查圖層',
            html: `
                <div class="audit-form-container" style="text-align: left;">
                    <div class="audit-form-group" style="margin-bottom: 12px;">
                        <label class="audit-form-label">1. 圖層名稱 <span class="required" style="color:red;">*必填</span></label>
                        <input id="swal-input-layer-name" type="text" class="swal2-input audit-form-input" placeholder="例如：測試05" style="width:100%; box-sizing:border-box;">
                        <div style="font-size: 12px; color: #7f8c8d; margin-top: 4px;">提示：直接輸入名稱，系統會自動建立 KML_ 格式。</div>
                    </div>
                    <div class="audit-form-group" style="margin-bottom: 12px;">
                        <label class="audit-form-label">2. 必填照片張數 (1~12 張)</label>
                        <input id="swal-input-count" type="number" class="swal2-input audit-form-input" value="2" min="1" max="12" step="1" style="width:100%; box-sizing:border-box;">
                    </div>
                    <div>
                        <label class="audit-form-label">3. 設備狀態選項 (用逗號或換行分隔)</label>
                        <textarea id="swal-input-status" class="swal2-textarea audit-form-textarea" style="width:100%; box-sizing:border-box; height:80px;">${defaultStatusStr}</textarea>
                    </div>
                </div>`,
            showCancelButton: true,
            confirmButtonText: '建立並啟用',
            cancelButtonText: '返回',
            focusConfirm: false,
            preConfirm: () => {
                let layerName = document.getElementById('swal-input-layer-name').value.trim();
                const countVal = parseInt(document.getElementById('swal-input-count').value, 10);
                const statusVal = document.getElementById('swal-input-status').value.trim();

                if (!layerName) {
                    Swal.showValidationMessage('請輸入圖層名稱！');
                    return false;
                }
                
                layerName = layerName.replace(/^KML_+/i, '');

                if (!layerName) {
                    Swal.showValidationMessage('請輸入有效的圖層名稱！');
                    return false;
                }

                if (!countVal || countVal < 1 || countVal > 12) {
                    Swal.showValidationMessage('照片張數必須介於 1 到 12 張之間！');
                    return false;
                }
                const optionsArray = statusVal.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
                if (!optionsArray.length) {
                    Swal.showValidationMessage('請至少輸入一個有效的設備狀態選項！');
                    return false;
                }
                return { layerName, count: countVal, options: optionsArray };
            }
        });

        if (formValues) {
            try {
                Swal.fire({ title: '正在建立空白圖層...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

                const cleanName = 'KML_' + formValues.layerName;
                const uniqueId = cleanName; 

                // 取得當前使用者 Email 與角色
                const currentUserEmail = auth.currentUser?.email || firebase.auth()?.currentUser?.email || '';
                const currentUserRole = window.currentUserRole || 'user';

                // 【修改重點】建構與傳統上傳 KML 100% 一致的資料欄位
                await firebase.firestore().collection(APP_PATH).doc(uniqueId).set({ 
                    name: cleanName,                                                // 對齊上傳 KML 核心欄位
                    layerName: cleanName,                                           // 保留向下相容
                    geojson: '{"type":"FeatureCollection","features":[]}',           // 提供標準空 GeoJSON 結構
                    isAuditing: true,                                               // 啟用清查狀態
                    statusOptions: formValues.options,                              // 設備狀態選項
                    targetPhotos: formValues.count,                                 // 照片必填張數
                    uploadTime: firebase.firestore.FieldValue.serverTimestamp(),   // 建立時間戳記
                    uploadedBy: currentUserEmail,                                   // 建立者 Email
                    uploadedByRole: currentUserRole                                 // 建立者角色
                }, { merge: true });

                localStorage.removeItem('kml_list_cache_data');

                const now = Date.now();
                const syncPath = APP_PATH.includes('kmlLayers') 
                    ? APP_PATH.replace('kmlLayers', 'metadata/sync') 
                    : APP_PATH + '/../metadata/sync';

                await firebase.firestore().doc(syncPath).set({ 
                    lastUpdate: now, 
                    lastUpdateTime: new Date(now).toLocaleString('zh-TW') 
                }, { merge: true });

                window.globalAuditConfigs ||= {};
                window.globalAuditConfigs[uniqueId] = {
                    isAuditing: true,
                    targetPhotos: formValues.count,
                    statusOptions: formValues.options
                };

                const selectEl = document.getElementById('kmlLayerSelect');
                if (selectEl) {
                    const opt = document.createElement('option');
                    opt.value = uniqueId;
                    opt.setAttribute('data-basename', cleanName);
                    opt.textContent = `${cleanName} (清查中:${formValues.count}張)`;
                    selectEl.appendChild(opt);
                    selectEl.value = uniqueId;
                    
                    selectEl.dispatchEvent(new Event('change'));
                }

                window.currentActiveKmlId = uniqueId;
                window.currentActiveKmlName = cleanName;

                if (window.mapNamespace) {
                    window.mapNamespace.currentKmlLayerId = uniqueId;
                    window.mapNamespace.allKmlFeatures = [];
                }

                forceMapRefresh();
                Swal.fire({ icon: 'success', title: '已成功建立並開啟空白清查圖層！', timer: 1500, showConfirmButton: false });

            } catch (error) {
                Swal.fire({ icon: 'error', title: '建立失敗', text: error.message });
            }
        } else {
            window.showAuditActionModal();
        }
    };
        
    // ---------------------------------------------------------
    // 5. 新增自訂點位與編輯 UI
    // ---------------------------------------------------------
    function setAddButtonActiveState(isActive) {
        const btn = document.getElementById('btn-standalone-add-point');
        if (!btn) return;
        btn.innerHTML = isActive ? '❌ 取消新增' : '➕ 新增點位';
        btn.style.setProperty('background-color', isActive ? '#e74c3c' : '#2ecc71', 'important');
    }

    function removeCenterAddReticle(container) {
        const targetContainer = container || window.mapNamespace?.map?.getContainer?.();
        if (!targetContainer) return;
        targetContainer.querySelectorAll('#audit-center-crosshair-reticle').forEach((el) => el.remove());
    }

    window.startAddCustomPoint = function(kmlId) {
        if (activeAddPointCleanup) {
            activeAddPointCleanup();
            Swal.fire({ icon: 'info', title: '已取消新增點位', timer: 1000, showConfirmButton: false });
            return;
        }

        const targetKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        if (!isAuditActiveForLayer(targetKmlId)) {
            return Swal.fire('權限不足或未開啟', '目前圖層未開啟清查，無法新增點位！', 'warning');
        }

        const map = window.mapNamespace?.map;
        if (!map) return;

        const container = map.getContainer();
        container.style.cursor = '';
        removeCenterAddReticle(container);
        setAddButtonActiveState(true);

        const reticleEl = document.createElement('div');
        reticleEl.id = 'audit-center-crosshair-reticle';
        reticleEl.title = '點按圓心確認新增點位位置';
        reticleEl.style.cssText = [
            'position: absolute;',
            'left: 50%;',
            'top: 50%;',
            'transform: translate(-50%, -50%);',
            'z-index: 950;',
            'width: 68px;',
            'height: 68px;',
            'display: flex;',
            'align-items: center;',
            'justify-content: center;',
            'pointer-events: auto;',
            'cursor: pointer;',
            'touch-action: manipulation;',
            'user-select: none;',
            '-webkit-tap-highlight-color: transparent;'
        ].join(' ');

        reticleEl.innerHTML = `
            <svg width="68" height="68" viewBox="0 0 68 68" aria-hidden="true" style="filter: drop-shadow(0 1px 3px rgba(0,0,0,0.6));">
                <circle cx="34" cy="34" r="19" fill="rgba(46, 204, 113, 0.16)" stroke="#ffffff" stroke-width="4" />
                <circle cx="34" cy="34" r="19" fill="none" stroke="#e74c3c" stroke-width="2" />
                <line x1="34" y1="4" x2="34" y2="21" stroke="#ffffff" stroke-width="4" stroke-linecap="round" />
                <line x1="34" y1="4" x2="34" y2="21" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" />
                <line x1="34" y1="47" x2="34" y2="64" stroke="#ffffff" stroke-width="4" stroke-linecap="round" />
                <line x1="34" y1="47" x2="34" y2="64" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" />
                <line x1="4" y1="34" x2="21" y2="34" stroke="#ffffff" stroke-width="4" stroke-linecap="round" />
                <line x1="4" y1="34" x2="21" y2="34" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" />
                <line x1="47" y1="34" x2="64" y2="34" stroke="#ffffff" stroke-width="4" stroke-linecap="round" />
                <line x1="47" y1="34" x2="64" y2="34" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" />
                <circle cx="34" cy="34" r="4" fill="#e74c3c" stroke="#ffffff" stroke-width="1.5" />
            </svg>
        `;

        container.appendChild(reticleEl);

        Swal.mixin({ toast: true, position: 'top', showConfirmButton: false, timer: 4000, timerProgressBar: true })
            .fire({ icon: 'info', title: '🎯 請拖曳地圖對準位置，再按中心圓心' });

        let isConfirming = false;

        const handleReticleConfirm = async function(e) {
            if (e) {
                e.stopPropagation();
                if (e.cancelable) e.preventDefault();
            }
            if (isConfirming) return;
            isConfirming = true;

            const center = map.getCenter();
            cleanup();

            if (center && typeof window.openAddPointModal === 'function') {
                await window.openAddPointModal(targetKmlId, center.lat, center.lng);
            }
        };

        const cleanup = () => {
            reticleEl.removeEventListener('click', handleReticleConfirm);
            reticleEl.removeEventListener('touchend', handleReticleConfirm);
            removeCenterAddReticle(container);
            container.style.cursor = '';
            activeAddPointCleanup = null;
            setAddButtonActiveState(false);
        };

        activeAddPointCleanup = cleanup;
        reticleEl.addEventListener('click', handleReticleConfirm);
        reticleEl.addEventListener('touchend', handleReticleConfirm, { passive: false });
    };

    (function renderStandaloneAddButton() {
        let btn = document.getElementById('btn-standalone-add-point') || document.createElement('button');
        btn.id = 'btn-standalone-add-point';
        btn.innerHTML = '➕ 新增點位';
        if (!btn.parentNode) document.body.appendChild(btn);

        btn.onclick = (e) => { e.stopPropagation(); window.startAddCustomPoint(); };
        syncAuditButtonVisibility();
    })();

    window.openAddPointModal = async function(param1, param2, param3) {
        if (typeof activeAddPointCleanup === 'function') {
            activeAddPointCleanup();
        }
        removeCenterAddReticle();

        const map = window.mapNamespace?.map;
        if (map) window.preAuditMapState = { center: map.getCenter(), zoom: map.getZoom() };

        let kmlId, lat, lng, editData = null, isEditMode = false;
        if (typeof param1 === 'object' && param1 !== null) {
            editData = param1; kmlId = editData.kmlId; lat = editData.lat; lng = editData.lng; isEditMode = !!editData.isEditMode;
        } else {
            kmlId = param1; lat = param2; lng = param3;
        }

        if (!isAuditActiveForLayer(kmlId)) return;

        // 追蹤此彈窗產生的 Object URL，避免重複選照或關窗後殘留記憶體
        const addPhotoUrls = new Map();
        const setAddPreviewUrl = (index, file) => {
            const oldUrl = addPhotoUrls.get(index);
            if (oldUrl) {
                try { URL.revokeObjectURL(oldUrl); } catch {}
            }
            const nextUrl = URL.createObjectURL(file);
            addPhotoUrls.set(index, nextUrl);
            return nextUrl;
        };
        const clearAllAddPreviewUrls = (modalEl) => {
            addPhotoUrls.forEach((url) => {
                try { URL.revokeObjectURL(url); } catch {}
            });
            addPhotoUrls.clear();
            if (modalEl) {
                modalEl.querySelectorAll('img[id^="add-prev-"]').forEach((imgEl) => {
                    imgEl.src = '';
                });
            }
        };

        window.handleAddPhotoPreview = function(input, index) {
            if (input.files?.[0]) {
                const previewUrl = setAddPreviewUrl(index, input.files[0]);
                const img = document.getElementById(`add-prev-${index}`);
                const icon = document.getElementById(`add-icon-${index}`);
                const tagText = document.getElementById(`add-tag-text-${index}`);

                if (img) { img.src = previewUrl; img.style.display = 'block'; }
                if (icon) icon.style.display = 'none';
                if (tagText) tagText.innerText = '已選取';
            }
        };

        const config = getSafeAuditConfig(kmlId);
        const maxPhotos = config.targetPhotos || 2;
        const existingPhotos = editData?.photos || [];
        const defaultName = editData?.pointKey || editData?.name || '';
        const defaultDesc = editData?.description || editData?.desc || '';
        const defaultRemark = editData?.note || editData?.remark || '';

        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const existingSrc = existingPhotos[i] || '';
            const hasPhoto = !!existingSrc;
            photoHtml += `
                <div class="audit-photo-item">
                    <div class="audit-photo-box">
                        <img id="add-prev-${i}" src="${existingSrc}" class="audit-photo-preview-img" style="display:${hasPhoto ? 'block' : 'none'};">
                        <span id="add-icon-${i}" class="audit-photo-icon" style="display:${hasPhoto ? 'none' : 'block'};">📷</span>
                        <input type="file" id="add-photo-input-${i}" accept="image/*" capture="environment" onchange="window.handleAddPhotoPreview(this, ${i})" class="audit-photo-input" title="現場拍照">
                    </div>
                    <label for="add-photo-input-${i}" class="audit-photo-tag">
                        <span>🖼</span> <span id="add-tag-text-${i}">${hasPhoto ? '已選取' : '圖庫'}</span>
                    </label>
                </div>`;
        }

        const kmlLayerName = getLayerFolderName(kmlId);
        const modalTitle = isEditMode ? '修改點位清查紀錄' : '新增點位清查紀錄';
        const confirmBtnText = isEditMode ? '確認並儲存修改' : '確認並新增上傳';

        const modalHtml = `
        <div class="audit-form-container">
            <div class="audit-modal-title">
                <span class="audit-modal-icon">${isEditMode ? '✏️' : '➕'}</span>
                <span>${modalTitle}</span>
            </div>
            <div class="audit-form-group-inline">
                <label class="audit-form-label">點位名稱 <span class="required">*必填</span></label>
                <input type="text" id="add-point-name" value="${safeEscape(defaultName)}" placeholder="例如：新設電桿-01" class="audit-form-input">
            </div>
            <div class="audit-form-group-inline">
                <label class="audit-form-label">設備狀態</label>
                <select id="add-device-status" disabled class="audit-form-select">
                    <option value="新增" selected>新增</option>
                </select>
            </div>
            <div class="audit-form-group">
                <label class="audit-form-label">現場照片 (需拍 ${maxPhotos} 張) <span class="required">*必填</span></label>
                <div class="audit-photo-grid">${photoHtml}</div>
            </div>
            <div class="audit-form-group" style="margin-top:10px;">
                <label class="audit-form-label">敘述 <span class="optional">(選填)</span></label>
                <input type="text" id="add-point-desc" value="${safeEscape(defaultDesc)}" placeholder="請輸入點位敘述..." class="audit-form-input">
            </div>
            <div>
                <label class="audit-form-label">備註事項 <span class="optional">(選填)</span></label>
                <input type="text" id="add-point-remark" value="${safeEscape(defaultRemark)}" placeholder="輸入備註事項..." class="audit-form-input">
            </div>
        </div>`;

        const { value: formValues } = await Swal.fire({
            html: modalHtml, showCancelButton: true, confirmButtonText: confirmBtnText, cancelButtonText: '取消',
            confirmButtonColor: '#2ecc71', cancelButtonColor: '#707a86', focusConfirm: false,
            didOpen: () => setPointAddBtnVisible(false),
            willClose: (modalEl) => {
                clearAllAddPreviewUrls(modalEl);
                syncAuditButtonVisibility();
            },
            preConfirm: () => {
                const name = document.getElementById('add-point-name').value.trim();
                const desc = document.getElementById('add-point-desc').value.trim();
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

                const ns = window.mapNamespace;
                const currentRecords = window.auditLayersState?.[kmlId] || {};
                if (!isEditMode || (isEditMode && defaultName !== name)) {
                    if (ns?.allKmlFeatures?.some(f => getPointKey(f.properties) === name) || currentRecords[name]) {
                        return Swal.showValidationMessage(`點名「${name}」已存在，請修改點位名稱！`);
                    }
                }

                if (photosArray.length < maxPhotos) return Swal.showValidationMessage(`請上傳完整 ${maxPhotos} 張現場照片！`);

                return {
                    kmlId, kmlLayerName, lat, lng, pointKey: name, name,
                    status: "新增", deviceStatus: "新增", description: desc, desc: desc,
                    remark, photos: photosArray, isEditMode, oldPointKey: isEditMode ? defaultName : null
                };
            }
        });

        if (formValues && typeof window.submitNewCustomPoint === 'function') {
            await window.submitNewCustomPoint(formValues);
            forceMapRefresh();
        }
    };

    window.submitNewCustomPoint = async function(formValues) {
        const { kmlId, kmlLayerName, lat, lng, pointKey, deviceStatus, description, desc, remark, photos, isEditMode, oldPointKey } = formValues;
        const trimmedPointKey = (pointKey || '').trim();
        const finalDesc = description || desc || '';
        const numLat = parseFloat(lat), numLng = parseFloat(lng);
        if (!trimmedPointKey || isNaN(numLat) || isNaN(numLng)) return Swal.fire('錯誤', '請提供有效的點位名稱與座標', 'error');

        const ns = window.mapNamespace;
        Swal.fire({ title: '正在處理並儲存資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

        try {
            const photoUrls = await window.uploadPhotosToStorage(photos, kmlId, trimmedPointKey, kmlLayerName);

            if (isEditMode && oldPointKey &&
    
    // ---------------------------------------------------------
    // 記憶體釋放工具區段 (集中管理 Canvas / Image / ObjectURL / 暫存相片)
    // ---------------------------------------------------------
    function releaseImageAndCanvas(imgEl, canvasEl) {
        if (canvasEl) {
            try {
                canvasEl.width = 0;
                canvasEl.height = 0;
            } catch {}
        }
        if (imgEl) {
            try {
                imgEl.onload = null;
                imgEl.onerror = null;
                imgEl.src = '';
            } catch {}
        }
    }

    function revokeBlobUrlSafe(url) {
        if (url && String(url).startsWith('blob:')) {
            try { URL.revokeObjectURL(url); } catch {}
        }
    }

    function releasePhotoTempItem(item) {
        if (!item) return;

        if (typeof item === 'string') {
            revokeBlobUrlSafe(item);
            return;
        }

        ['previewUrl', 'url', 'objectUrl'].forEach((key) => {
            revokeBlobUrlSafe(item[key]);
            item[key] = null;
        });

        releaseImageAndCanvas(item.imgEl, item.canvasEl);
        item.imgEl = null;
        item.canvasEl = null;

        item.blob = null;
        item.file = null;
        item.base64 = null;
        item.dataUrl = null;
    }

    function clearPointAuditTempPhotos(kmlId, pointKey) {
        const stateContainer = window.auditTempPhotos || window.tempAuditPhotos;
        if (!stateContainer || typeof stateContainer !== 'object') return;

        const target = stateContainer?.[kmlId]?.[pointKey] || stateContainer?.[pointKey];
        if (!target) return;

        if (Array.isArray(target)) {
            target.forEach(releasePhotoTempItem);
            target.length = 0;
        } else if (typeof target === 'object') {
            Object.keys(target).forEach((key) => {
                releasePhotoTempItem(target[key]);
                delete target[key];
            });
        }

        if (stateContainer[kmlId] && stateContainer[kmlId][pointKey]) {
            delete stateContainer[kmlId][pointKey];
        } else if (stateContainer[pointKey]) {
            delete stateContainer[pointKey];
        }
    }

    function createEditorPhotoMemoryManager() {
        const editorPhotoUrls = new Map();

        const replaceSlotUrl = (index, nextUrl) => {
            const oldUrl = editorPhotoUrls.get(index);
            if (oldUrl && oldUrl !== nextUrl) {
                revokeBlobUrlSafe(oldUrl);
            }
            if (nextUrl) {
                editorPhotoUrls.set(index, nextUrl);
            } else {
                editorPhotoUrls.delete(index);
            }
        };

        const clearAll = (modalEl) => {
            editorPhotoUrls.forEach((url) => revokeBlobUrlSafe(url));
            editorPhotoUrls.clear();

            if (modalEl) {
                modalEl.querySelectorAll('img[id^="audit-prev-"]').forEach((imgEl) => {
                    imgEl.src = '';
                });
                modalEl.querySelectorAll('input[type="file"]').forEach((inputEl) => {
                    try { inputEl.value = ''; } catch {}
                });
            }
        };

        return { replaceSlotUrl, clearAll };
    }

    function scheduleBackgroundPhotoCleanup(resObj, kmlId, pointKey) {
        const pendingPhotosBuffer = resObj && Array.isArray(resObj.photos) ? resObj.photos : null;
        if (resObj) {
            resObj.photos = null;
        }

        setTimeout(() => {
            try {
                if (pendingPhotosBuffer) {
                    pendingPhotosBuffer.forEach(releasePhotoTempItem);
                    pendingPhotosBuffer.length = 0;
                }
                clearPointAuditTempPhotos(kmlId, pointKey);
            } catch {}
        }, 50);
    }

    // ---------------------------------------------------------
    // 照片壓縮與上傳區段 (寬度固定 1920 等比縮放 + 先逐張壓縮釋放再平行上傳)
    // ---------------------------------------------------------
    async function compressImageToCanvas(source) {
        return new Promise((resolve) => {
            if (typeof source === 'string' && source.startsWith('http')) {
                return resolve(source);
            }

            const img = new Image();
            const isObjectUrl = typeof source !== 'string';
            const url = isObjectUrl ? URL.createObjectURL(source) : source;
            let canvas = null;

            const cleanup = () => {
                if (isObjectUrl) {
                    revokeBlobUrlSafe(url);
                }
                releaseImageAndCanvas(img, canvas);
                canvas = null;
            };

            img.onload = () => {
                try {
                    canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const targetWidth = 1920;

                    if (width > targetWidth) {
                        height = Math.round(height * (targetWidth / width));
                        width = targetWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        const resultBlob = blob || source;
                        cleanup();
                        resolve(resultBlob);
                    }, 'image/jpeg', 0.75);
                } catch {
                    cleanup();
                    resolve(source);
                }
            };

            img.onerror = () => {
                cleanup();
                resolve(source);
            };

            img.src = url;
        });
    }

    window.uploadPhotosToStorage = async function(photos, kmlId, pointKey, kmlLayerName) {
        if (!photos || !Array.isArray(photos) || !photos.length) return [];
        if (!firebase?.storage) throw new Error("Firebase Storage SDK 未載入");

        const targetLayerName = kmlLayerName || getLayerFolderName(kmlId);
        const storageRef = firebase.storage().ref();
        const safePointKey = String(pointKey || 'point').replace(/[/\\?%*:|"<>]/g, '_');

        // 1. 先逐張壓縮並釋放畫布，避免多張原圖同時解碼造成記憶體尖峰
        const preparedItems = [];
        for (let index = 0; index < photos.length; index++) {
            const photoData = photos[index];
            if (!photoData) {
                preparedItems.push({ index, type: 'empty', value: '' });
                continue;
            }

            if (
                typeof photoData === 'string' &&
                !photoData.startsWith('data:image') &&
                !photoData.startsWith('blob:') &&
                !(photoData instanceof File || photoData instanceof Blob)
            ) {
                preparedItems.push({ index, type: 'existingUrl', value: photoData });
                photos[index] = null;
                continue;
            }

            const compressedBlob = await compressImageToCanvas(photoData);
            preparedItems.push({ index, type: 'upload', blob: compressedBlob });
            photos[index] = null;
        }

        // 2. 壓縮完成後再平行上傳至 Firebase Storage
        const results = await Promise.all(
            preparedItems.map(async (item) => {
                if (item.type === 'empty') return { index: item.index, url: '' };
                if (item.type === 'existingUrl') return { index: item.index, url: item.value };

                const customStoragePath = `${STORAGE_ROOT}/${targetLayerName}/${safePointKey}_${String(item.index + 1).padStart(2, '0')}.jpg`;
                const ref = storageRef.child(customStoragePath);
                try {
                    await ref.put(item.blob);
                    const downloadUrl = await ref.getDownloadURL();
                    return { index: item.index, url: downloadUrl };
                } finally {
                    item.blob = null;
                }
            })
        );

        const photoUrls = new Array(photos.length).fill('');
        results.forEach(({ index, url }) => {
            photoUrls[index] = url;
        });
        return photoUrls;
    };

    // ---------------------------------------------------------
    // 點位刪除區段
    // ---------------------------------------------------------
    window.deleteCustomPoint = async function(kmlId, pointKey, kmlLayerName) {
        if (!kmlId || !pointKey || !isAuditActiveForLayer(kmlId)) return;

        const confirmRes = await Swal.fire({
            title: '確定要刪除此點位？', text: `將刪除點位「${pointKey}」及其照片！`, icon: 'warning',
            showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: '確定刪除', cancelButtonText: '取消'
        });

        if (!confirmRes.isConfirmed) return;

        Swal.fire({ title: '正在刪除點位...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

        try {
            const targetLayerName = kmlLayerName || getLayerFolderName(kmlId);
            const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');
            const storageRef = firebase.storage().ref();

            await Promise.all([1, 2, 3].map(async (i) => {
                try { await storageRef.child(`${STORAGE_ROOT}/${targetLayerName}/${safePointKey}_${String(i).padStart(2, '0')}.jpg`).delete(); } catch {}
            }));

            await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pointKey).delete();
            delete window.auditLayersState?.[kmlId]?.[pointKey];
            clearPointAuditTempPhotos(kmlId, pointKey);

            const ns = window.mapNamespace;
            if (ns?.allKmlFeatures) ns.allKmlFeatures = ns.allKmlFeatures.filter(f => getPointKey(f.properties) !== pointKey);

            window.currentSelectedPoint = null;
            await generateLayerCsvReport(kmlId, targetLayerName, 2);

            Swal.fire({ icon: 'success', title: '已順利刪除點位', timer: 1200, showConfirmButton: false });
            forceMapRefresh();
        } catch (e) {
            Swal.fire('錯誤', e.message || '刪除失敗', 'error');
        }
    };

    // ---------------------------------------------------------
    // 6. 清查資料彈窗 (編輯與查看 - 同步極速預覽與記憶體釋放修復)
    // ---------------------------------------------------------
    window.openAuditEditor = async function(isModifyMode = false) {
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) return;

        const layerProps = activePoint.feature?.properties || activePoint.properties || {};
        const pointKey = getPointKey(layerProps);
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;

        if (!isAuditActiveForLayer(kmlId)) return;

        const config = getSafeAuditConfig(kmlId);
        const maxPhotos = config.targetPhotos || 2;
        const kmlLayerName = getLayerFolderName(kmlId);
        const historyRecord = isModifyMode ? (window.auditLayersState?.[kmlId]?.[pointKey] || {}) : {};

        const isUserCreatedPoint = !!(historyRecord.deviceStatus === '新增' || layerProps.deviceStatus === '新增');
        const currentPhotos = new Array(maxPhotos).fill('');
        if (isModifyMode && Array.isArray(historyRecord.photos)) {
            historyRecord.photos.forEach((url, idx) => { if (idx < maxPhotos) currentPhotos[idx] = url || ''; });
        }

        const currentStatus = isUserCreatedPoint ? '新增' : (historyRecord.deviceStatus || '');
        const currentDesc = historyRecord.description || historyRecord.desc || '';
        const currentNote = historyRecord.note || '';
        const baseStatusOptions = config.statusOptions || ['正常', '損壞', '遺失'];

        const photoMemory = createEditorPhotoMemoryManager();

        let statusSelectHtml = isUserCreatedPoint ? `
            <select id="swal-status" class="swal2-input audit-form-select" disabled>
                <option value="新增" selected>新增</option>
            </select>` : `
            <select id="swal-status" class="swal2-input audit-form-select">
                <option value="" ${!currentStatus ? 'selected' : ''}>--- 請選擇設備狀態 ---</option>
                ${baseStatusOptions.filter(opt => opt !== '新增').map(opt => `<option value="${opt}" ${currentStatus === opt ? 'selected' : ''}>${opt}</option>`).join('')}
            </select>`;

        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const photoData = currentPhotos[i] || '';
            const isUrl = photoData.startsWith('http');
            photoHtml += `
                <div class="audit-photo-item-editor">
                    <div class="audit-photo-box-editor">
                        <img id="audit-prev-${i}" src="${photoData}" class="audit-photo-preview-img" style="display:${photoData ? 'block' : 'none'};">
                        <span id="audit-icon-${i}" class="audit-photo-icon" style="display:${photoData ? 'none' : 'block'};">📷</span>
                        <input type="file" id="audit-file-input-${i}" accept="image/*" capture="environment" class="audit-photo-input" title="直接拍照">
                    </div>
                    <input type="file" id="audit-gallery-input-${i}" accept="image/*" style="display:none;">
                    <label for="audit-gallery-input-${i}" id="audit-tag-${i}" class="audit-photo-tag-editor">
                        ${isUrl ? '<span>🖼️</span> 舊照片' : (photoData ? '<span>🖼️</span> 新選擇' : '<span>📁</span> 開啟舊檔')}
                    </label>
                </div>`;
        }

        const { value: res, isDenied } = await Swal.fire({
            title: `<div>${isModifyMode ? '修改' : '填寫'}清查紀錄：${safeEscape(pointKey)}</div>`,
            html: `<div class="audit-form-container">
                <div class="audit-form-group-inline">
                    <label class="audit-form-label">設備狀態 <span class="required">*必選</span></label>
                    ${statusSelectHtml}
                </div>

                <label class="audit-form-label">現場照片 (需滿 ${maxPhotos} 張) <span class="required">*必填</span></label>
                <div class="audit-photo-grid-editor">${photoHtml}</div>

                <div class="audit-form-group">
                    <label class="audit-form-label">敘述 <span class="optional">(選填)</span></label>
                    <input type="text" id="swal-desc" class="swal2-input audit-form-input" value="${safeEscape(currentDesc)}" placeholder="請輸入點位敘述...">
                </div>

                <div class="audit-form-group">
                    <label class="audit-form-label">備註事項 <span class="optional">(選填)</span></label>
                    <input type="text" id="swal-note" class="swal2-input audit-form-input" value="${safeEscape(currentNote)}" placeholder="輸入備註事項...">
                </div>
            </div>`,
            showCancelButton: true, showDenyButton: isUserCreatedPoint, denyButtonText: '🗑️ 刪除點位', denyButtonColor: '#e74c3c',
            confirmButtonText: isModifyMode ? '覆蓋更新' : '確認並上傳', cancelButtonText: '取消',
            didOpen: (modalEl) => {
                setPointAddBtnVisible(false);
                const handlePhotoChange = (inputEl, index) => {
                    if (inputEl.files?.[0]) {
                        const file = inputEl.files[0];
                        const previewUrl = URL.createObjectURL(file);
                        photoMemory.replaceSlotUrl(index, previewUrl);

                        const prevEl = document.getElementById(`audit-prev-${index}`);
                        const iconEl = document.getElementById(`audit-icon-${index}`);
                        const tagEl = document.getElementById(`audit-tag-${index}`);

                        if (prevEl) { prevEl.src = previewUrl; prevEl.style.display = 'block'; }
                        if (iconEl) iconEl.style.display = 'none';
                        if (tagEl) tagEl.innerHTML = '<span>🖼️</span> 新選擇';
                    }
                };
                for (let i = 0; i < maxPhotos; i++) {
                    modalEl.querySelector(`#audit-file-input-${i}`)?.addEventListener('change', (e) => handlePhotoChange(e.target, i));
                    modalEl.querySelector(`#audit-gallery-input-${i}`)?.addEventListener('change', (e) => handlePhotoChange(e.target, i));
                }
            },
            willClose: (modalEl) => {
                photoMemory.clearAll(modalEl);
                syncAuditButtonVisibility();
            },
            preConfirm: () => {
                const statusValue = document.getElementById('swal-status').value;
                if (!statusValue) return Swal.showValidationMessage('請選擇設備狀態');

                const finalPhotos = [];
                for (let i = 0; i < maxPhotos; i++) {
                    const cameraInput = document.getElementById(`audit-file-input-${i}`);
                    const galleryInput = document.getElementById(`audit-gallery-input-${i}`);
                    const imgEl = document.getElementById(`audit-prev-${i}`);

                    if (cameraInput?.files?.[0]) {
                        finalPhotos.push(cameraInput.files[0]);
                    } else if (galleryInput?.files?.[0]) {
                        finalPhotos.push(galleryInput.files[0]);
                    } else if (imgEl?.src && (imgEl.src.startsWith('http') || imgEl.src.startsWith('data:'))) {
                        finalPhotos.push(imgEl.src);
                    }
                }

                if (finalPhotos.length < maxPhotos) {
                    return Swal.showValidationMessage(`請補滿 ${maxPhotos} 張照片 (目前 ${finalPhotos.length}/${maxPhotos})`);
                }

                const descValue = document.getElementById('swal-desc')?.value.trim() || '';

                return {
                    status: statusValue,
                    description: descValue,
                    desc: descValue,
                    note: document.getElementById('swal-note')?.value.trim() || '',
                    photos: finalPhotos
                };
            }
        });

        if (isDenied) return window.deleteCustomPoint(kmlId, pointKey, kmlLayerName);

        if (res) {
            Swal.fire({ title: '正在上傳與更新資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const photoUrls = await window.uploadPhotosToStorage(res.photos, kmlId, pointKey, kmlLayerName);
                const nowTime = new Date();
                const structuredData = {
                    pointName: pointKey,
                    status: "已完成",
                    deviceStatus: res.status,
                    description: res.description,
                    desc: res.desc,
                    note: res.note,
                    photos: photoUrls,
                    updatedAt: nowTime
                };

                window.auditLayersState ||= {};
                window.auditLayersState[kmlId] ||= {};
                window.auditLayersState[kmlId][pointKey] = { ...window.auditLayersState[kmlId][pointKey], ...structuredData };

                if (layerProps) {
                    layerProps.description = res.description;
                    layerProps.desc = res.desc;
                }

                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pointKey).set(structuredData, { merge: true });
                await generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos);

                // 1. 確實全部完成後才顯示「更新成功」
                await Swal.fire({ icon: 'success', title: '更新成功', timer: 800, showConfirmButton: false });

                // 2. 返回／刷新地圖
                forceMapRefresh();

                // 3. 返回地圖後背景清除拍照暫存記憶體
                scheduleBackgroundPhotoCleanup(res, kmlId, pointKey);
            } catch (e) {
                Swal.fire('錯誤', e.message || '儲存失敗', 'error');
            }
        }
    };

    window.viewAuditDetailOnly = function(pointKeyParam) {
        const activePoint = window.currentSelectedPoint;
        const layerProps = activePoint?.feature?.properties || activePoint?.properties || {};
        const pointKey = pointKeyParam || (typeof getPointKey === 'function' ? getPointKey(layerProps) : null) || layerProps.name || layerProps.id;
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;

        if (!pointKey) {
            return Swal.fire('提示', '無法辨識點位名稱！', 'warning');
        }

        const record = window.auditLayersState?.[kmlId]?.[pointKey] || layerProps;

        if (!record || (!record.deviceStatus && !record.status && !record.photos)) {
            return Swal.fire('提示', `尚無「${safeEscape(pointKey)}」的清查紀錄！`, 'info');
        }

        const deviceStatus = record.deviceStatus || record.status || '未設定';
        const description = record.description || record.desc || layerProps.description || layerProps.desc || '';
        const note = record.note || record.remark || '';
        const photos = Array.isArray(record.photos) ? record.photos.filter(p => p && p.trim() !== '') : [];

        let photoHtml = '';
        if (photos.length > 0) {
            photos.forEach((url, idx) => {
                const safeUrl = safeEscape(url);
                photoHtml += `
                    <div class="audit-photo-item-editor">
                        <div class="audit-photo-box-editor readonly-clickable" onclick="window.open('${safeUrl}', '_blank')" title="點擊檢視原圖">
                            <img src="${safeUrl}" class="audit-photo-preview-img">
                        </div>
                        <div class="audit-photo-tag-editor" onclick="window.open('${safeUrl}', '_blank')" title="點擊檢視原圖">
                            <span>🖼️</span> 檢視照片 ${idx + 1}
                        </div>
                    </div>`;
            });
        } else {
            photoHtml = `<div class="audit-photo-empty-text">未提供現場照片</div>`;
        }

        Swal.fire({
            title: `查看清查紀錄：${safeEscape(pointKey)}`,
            html: `
                <div class="audit-form-container">

                    <!-- 1. 設備狀態 (唯讀下拉選單) -->
                    <div class="audit-form-group-inline">
                        <label class="audit-form-label">設備狀態</label>
                        <select class="swal2-input audit-form-select" disabled>
                            <option selected>${safeEscape(deviceStatus)}</option>
                        </select>
                    </div>

                    <!-- 2. 現場照片 (與編輯框樣式相同的外框與外觀) -->
                    <div class="audit-form-group">
                        <label class="audit-form-label">現場照片 (共 ${photos.length} 張)</label>
                        <div class="audit-photo-grid-editor">
                            ${photoHtml}
                        </div>
                    </div>

                    <!-- 3. 敘述 (唯讀輸入框) -->
                    <div class="audit-form-group">
                        <label class="audit-form-label">敘述 <span class="optional">(選填)</span></label>
                        <input type="text" class="swal2-input audit-form-input" value="${safeEscape(description)}" readonly placeholder="無敘述">
                    </div>

                    <!-- 4. 備註事項 (唯讀輸入框) -->
                    <div class="audit-form-group">
                        <label class="audit-form-label">備註事項 <span class="optional">(選填)</span></label>
                        <input type="text" class="swal2-input audit-form-input" value="${safeEscape(note)}" readonly placeholder="無備註事項">
                    </div>

                </div>`,
            confirmButtonText: '關閉',
            confirmButtonColor: '#34495e',
            showCloseButton: true,
            focusConfirm: false,
            didOpen: () => typeof setPointAddBtnVisible === 'function' && setPointAddBtnVisible(false),
            willClose: () => typeof syncAuditButtonVisibility === 'function' && syncAuditButtonVisibility()
        });
    };
          
    // ---------------------------------------------------------
    // 7-1. 水印壓製工具函數 (預覽與匯出共用同一渲染核心)
    // ---------------------------------------------------------
    async function getStoragePhotoTime(fileRef, fallbackRecordTime = "") {
        try {
            const metadata = await fileRef.getMetadata();
            const timeStr = metadata.timeCreated || metadata.updated;
            if (timeStr) {
                const dateObj = new Date(timeStr);
                if (!isNaN(dateObj.getTime())) {
                    return dateObj.toLocaleString('sv', { timeZone: 'Asia/Taipei' });
                }
            }
        } catch (e) {
            console.warn("無法取得 Storage Metadata 時間，使用紀錄時間替代:", e);
        }
        return fallbackRecordTime || "無時間紀錄";
    }

    function parseHexColorToRgb(hex, fallback = { r: 0, g: 0, b: 0 }) {
        const clean = String(hex || '').trim().replace('#', '');
        if (!clean) return fallback;
        const full = clean.length === 3
            ? clean.split('').map(c => c + c).join('')
            : clean.padEnd(6, '0').slice(0, 6);
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        if ([r, g, b].some(n => Number.isNaN(n))) return fallback;
        return { r, g, b };
    }

    function buildWatermarkLines({ showPoint, showTime, showPrefix, pointName, photoTime }) {
        const lines = [];
        if (showPoint && pointName) {
            lines.push(showPrefix ? `點號: ${pointName}` : String(pointName));
        }
        if (showTime && photoTime) {
            lines.push(showPrefix ? `時間: ${photoTime}` : String(photoTime));
        }
        return lines;
    }

    function renderWatermarkOnContext(ctx, canvasWidth, canvasHeight, options = {}) {
        const {
            showPoint = false,
            showTime = false,
            showPrefix = false,
            pointName = '',
            photoTime = '',
            position = 'bottom-right',
            customFontSize = 20,
            fontColor = '#FFFFFF',
            bgColor = '#000000',
            transparentBg = false,
            bgAlpha = 0.65
        } = options;

        const textLines = buildWatermarkLines({
            showPoint,
            showTime,
            showPrefix,
            pointName,
            photoTime
        });
        if (textLines.length === 0) return;

        const parsedSize = parseFloat(customFontSize);
        const safeBaseSize = (!Number.isNaN(parsedSize) && parsedSize > 0) ? parsedSize : 20;
        const ratio = canvasWidth / 1000;
        const fontSize = Math.max(1, safeBaseSize * ratio);
        const padX = Math.max(2, fontSize * 0.5);
        const padY = Math.max(2, fontSize * 0.45);
        const lineHeight = fontSize * 1.3;
        const margin = Math.max(3, canvasWidth * 0.015);
        const radius = Math.max(1, 6 * ratio);

        ctx.save();
        ctx.font = `bold ${fontSize}px sans-serif`;

        let maxTextWidth = 0;
        textLines.forEach(line => {
            const metrics = ctx.measureText(line);
            if (metrics.width > maxTextWidth) maxTextWidth = metrics.width;
        });

        const bgWidth = Math.min(canvasWidth - margin * 2, maxTextWidth + padX * 2);
        const bgHeight = (lineHeight * textLines.length) + (padY * 2);

        const x = (position === 'bottom-left')
            ? margin
            : (canvasWidth - bgWidth - margin);
        const y = canvasHeight - bgHeight - margin;

        const effectiveAlpha = transparentBg ? 0 : bgAlpha;
        if (effectiveAlpha > 0) {
            const rgb = parseHexColorToRgb(bgColor, { r: 0, g: 0, b: 0 });
            ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${effectiveAlpha})`;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(x, y, bgWidth, bgHeight, radius);
            } else {
                ctx.rect(x, y, bgWidth, bgHeight);
            }
            ctx.fill();
        }

        ctx.fillStyle = fontColor || '#FFFFFF';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = Math.max(0.5, 3 * ratio);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        textLines.forEach((line, index) => {
            const centerY = y + padY + index * lineHeight + (lineHeight / 2);
            ctx.fillText(line, x + padX, centerY, bgWidth - padX * 2);
        });

        ctx.restore();
    }

    function renderCompositeCanvas(sourceImg, fallbackWidth, fallbackHeight, options = {}) {
        const srcW = sourceImg ? (sourceImg.naturalWidth || sourceImg.width) : fallbackWidth;
        const srcH = sourceImg ? (sourceImg.naturalHeight || sourceImg.height) : fallbackHeight;

        const canvas = document.createElement('canvas');
        canvas.width = srcW;
        canvas.height = srcH;
        const ctx = canvas.getContext('2d');

        if (sourceImg) {
            ctx.drawImage(sourceImg, 0, 0, srcW, srcH);
        } else {
            const grad = ctx.createLinearGradient(0, 0, srcW, srcH);
            grad.addColorStop(0, '#334155');
            grad.addColorStop(1, '#1e293b');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, srcW, srcH);

            ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
            ctx.lineWidth = Math.max(1, srcW / 320);
            const step = Math.max(24, Math.round(srcW / 14));
            for (let x = 0; x < srcW; x += step) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, srcH); ctx.stroke();
            }
            for (let y = 0; y < srcH; y += step) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(srcW, y); ctx.stroke();
            }
        }

        renderWatermarkOnContext(ctx, srcW, srcH, options);
        return canvas;
    }

    async function addWatermarkToImage(imageBlob, options = {}) {
        const { showPoint = false, showTime = false } = options;
        if (!showPoint && !showTime) return imageBlob;

        return new Promise((resolve) => {
            const img = new Image();
            const url = URL.createObjectURL(imageBlob);

            img.onload = () => {
                URL.revokeObjectURL(url);

                const lines = buildWatermarkLines(options);
                if (lines.length === 0) {
                    img.src = '';
                    return resolve(imageBlob);
                }

                const canvas = renderCompositeCanvas(img, img.width, img.height, options);
                canvas.toBlob((blob) => {
                    canvas.width = 0;
                    canvas.height = 0;
                    img.src = '';
                    resolve(blob || imageBlob);
                }, 'image/jpeg', 0.75);
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                img.src = '';
                resolve(imageBlob);
            };

            img.src = url;
        });
    }

    // ---------------------------------------------------------
    // 7-2. 打包 Firebase Storage 照片 (拍照時間預設不勾選 + 修正下拉框垂直置中)
    // ---------------------------------------------------------
    window.downloadAuditPhotosZip = async function(kmlId) {
        if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
            return Swal.fire('套件缺失', '請確保 HTML 已引入 JSZip 與 FileSaver 套件！', 'error');
        }

        const cleanLayerName = getLayerFolderName(kmlId, kmlId);
        const storageFolderPath = `${STORAGE_ROOT}/${cleanLayerName}`;

        let previewSampleImg = null;
        let previewSamplePoint = 'NVA015';
        let previewSampleTime = new Date().toLocaleString('sv', { timeZone: 'Asia/Taipei' });
        let isPreviewLoading = false;
        let isModalClosed = false;

        const renderWatermarkPreview = () => {
            const canvas = document.getElementById('swal-wm-preview-canvas');
            const statusEl = document.getElementById('swal-wm-preview-status');
            if (!canvas) return;

            const enabled = !!document.getElementById('swal-wm-enable')?.checked;
            const showPoint = !!document.getElementById('swal-wm-chk-point')?.checked;
            const showTime = !!document.getElementById('swal-wm-chk-time')?.checked;
            const showPrefix = !!document.getElementById('swal-wm-chk-prefix')?.checked;
            const transparentBg = !!document.getElementById('swal-wm-chk-transparent')?.checked;
            const position = document.getElementById('swal-wm-pos')?.value || 'bottom-right';
            const fontSize = parseFloat(document.getElementById('swal-wm-size')?.value);
            const validFontSize = (!Number.isNaN(fontSize) && fontSize > 0) ? fontSize : 20;
            const fontColor = document.getElementById('swal-wm-font-color')?.value || '#ffffff';
            const bgColor = document.getElementById('swal-wm-bg-color')?.value || '#000000';

            if (!enabled) {
                canvas.height = 180;
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                return;
            }

            if (statusEl) {
                statusEl.textContent = isPreviewLoading
                    ? '正在背景載入實拍底圖...'
                    : (previewSampleImg ? '已套用資料夾實拍底圖' : '目前使用模擬底圖預覽');
            }

            const fallbackW = 1000;
            const fallbackH = 625;
            const fullComposite = renderCompositeCanvas(previewSampleImg, fallbackW, fallbackH, {
                showPoint,
                showTime,
                showPrefix,
                pointName: previewSamplePoint,
                photoTime: previewSampleTime,
                position,
                customFontSize: validFontSize,
                fontColor,
                bgColor,
                transparentBg,
                bgAlpha: 0.65
            });

            const aspectRatio = fullComposite.height / Math.max(1, fullComposite.width);
            const targetH = Math.max(80, Math.round(canvas.width * aspectRatio));
            if (canvas.height !== targetH) {
                canvas.height = targetH;
            }

            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(fullComposite, 0, 0, canvas.width, canvas.height);

            if (!previewSampleImg && isPreviewLoading) {
                ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
                ctx.font = 'bold 13px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('載入實拍底圖中...', canvas.width / 2, canvas.height * 0.35);
            }

            fullComposite.width = 0;
            fullComposite.height = 0;
        };

        const loadPreviewInBackground = async () => {
            isPreviewLoading = true;
            try {
                const listResult = await firebase.storage().ref(storageFolderPath).listAll();
                if (isModalClosed) return;

                const firstItem = listResult.items?.[0];
                if (!firstItem) return;

                previewSamplePoint = firstItem.name.replace(/_\d+\.[^/.]+$/, '').trim() || 'NVA015';
                const url = await firstItem.getDownloadURL();
                if (isModalClosed) return;

                const res = await fetch(url);
                if (!res.ok || isModalClosed) return;

                const blob = await res.blob();
                if (isModalClosed) return;

                const objUrl = URL.createObjectURL(blob);
                const img = await new Promise((resolve) => {
                    const el = new Image();
                    el.onload = () => {
                        URL.revokeObjectURL(objUrl);
                        resolve(el);
                    };
                    el.onerror = () => {
                        URL.revokeObjectURL(objUrl);
                        resolve(null);
                    };
                    el.src = objUrl;
                });

                if (!isModalClosed && img) {
                    previewSampleImg = img;
                }
            } catch {
                // 背景預覽失敗不影響主流程
            } finally {
                isPreviewLoading = false;
                if (!isModalClosed && document.getElementById('swal-wm-enable')?.checked) {
                    renderWatermarkPreview();
                }
            }
        };

        const colorSwatches = [
            { label: '白', hex: '#ffffff' },
            { label: '黑', hex: '#000000' },
            { label: '紅', hex: '#ef4444' },
            { label: '藍', hex: '#3b82f6' }
        ];
        const cardStyle = 'border: 1.5px solid #cbd5e1; border-radius: 6px; padding: 6px; background: #ffffff;';
        const cellStyle = 'padding: 5px 4px; border-right: 1.5px solid #cbd5e1; min-width: 0;';
        const lastCellStyle = 'padding: 5px 4px; min-width: 0;';

        const { value: watermarkSettings } = await Swal.fire({
            title: '📸 打包照片與水印設定',
            html: `
                <div style="text-align: left; font-size: 12px;" class="audit-form-container">
                    <div style="margin-bottom: 8px; padding: 7px 10px; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 6px;">
                        <label style="cursor: pointer; display: flex; align-items: center; gap: 8px; font-weight: 600; margin: 0; font-size: 14px;">
                            <input type="checkbox" id="swal-wm-enable" style="width: 18px; height: 18px; cursor: pointer;">
                            <span>加上浮水印</span>
                        </label>
                    </div>

                    <div id="swal-wm-options-panel" style="display: none;">
                        <div style="margin-bottom: 8px; ${cardStyle}">
                            <label class="audit-form-label" style="font-weight: bold; display: block; margin-bottom: 5px;">水印內容：</label>
                            <div style="display: flex; gap: 14px; align-items: center; padding: 2px 0; flex-wrap: wrap;">
                                <label style="cursor: pointer; display: flex; align-items: center; gap: 5px;">
                                    <input type="checkbox" id="swal-wm-chk-point" checked style="width: 16px; height: 16px; cursor: pointer;">
                                    <span>點號名稱</span>
                                </label>
                                <label style="cursor: pointer; display: flex; align-items: center; gap: 5px;">
                                    <input type="checkbox" id="swal-wm-chk-time" style="width: 16px; height: 16px; cursor: pointer;">
                                    <span>拍照時間</span>
                                </label>
                                <label style="cursor: pointer; display: flex; align-items: center; gap: 5px;">
                                    <input type="checkbox" id="swal-wm-chk-prefix" style="width: 16px; height: 16px; cursor: pointer;">
                                    <span>前綴</span>
                                </label>
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; margin-bottom: 8px; border: 1.5px solid #cbd5e1; border-radius: 6px; overflow: hidden; background: #ffffff; align-items: stretch;">
                            <div style="${cellStyle}">
                                <label class="audit-form-label" style="font-weight: bold; display: block; margin-bottom: 5px; font-size: 11px; white-space: nowrap;">水印位置</label>
                                <select id="swal-wm-pos" class="swal2-input audit-form-select" style="margin: 0; width: 100%; height: 32px; line-height: 1.2; padding: 0 4px; font-size: 11px; box-sizing: border-box;">
                                    <option value="bottom-right" selected>↘ 右下角</option>
                                    <option value="bottom-left">↙ 左下角</option>
                                </select>
                            </div>

                            <div style="${cellStyle}">
                                <label class="audit-form-label" style="font-weight: bold; display: block; margin-bottom: 5px; font-size: 11px; white-space: nowrap;">水印字體</label>
                                <div style="display: flex; align-items: center; gap: 4px;">
                                    <input id="swal-wm-size" type="number" class="swal2-input audit-form-input" value="20" min="1" max="100" step="1" style="margin: 0; width: 100%; height: 32px; line-height: 1.2; padding: 0 4px; font-size: 11px; box-sizing: border-box;">
                                    <input id="swal-wm-font-color" type="color" value="#ffffff" title="字體顏色" style="width: 26px; height: 32px; padding: 0; border: 1px solid #cbd5e1; border-radius: 3px; cursor: pointer; flex-shrink: 0;">
                                </div>
                                <div style="display: flex; gap: 4px; margin-top: 5px; flex-wrap: wrap;">
                                    ${colorSwatches.map(s => `<button type="button" class="swal-font-swatch" data-color="${s.hex}" title="${s.label}" style="width: 16px; height: 16px; border-radius: 3px; border: 1px solid #64748b; background: ${s.hex}; cursor: pointer; padding: 0;"></button>`).join('')}
                                </div>
                            </div>

                            <div style="${lastCellStyle}">
                                <label class="audit-form-label" style="font-weight: bold; display: block; margin-bottom: 5px; font-size: 11px; white-space: nowrap;">水印底色</label>
                                <div style="display: flex; align-items: center; gap: 4px;">
                                    <input id="swal-wm-bg-color" type="color" value="#000000" title="水印底色" style="width: 100%; height: 32px; padding: 0; border: 1px solid #cbd5e1; border-radius: 3px; cursor: pointer; box-sizing: border-box;">
                                    <label style="cursor: pointer; display: inline-flex; align-items: center; gap: 2px; font-size: 11px; white-space: nowrap; flex-shrink: 0;">
                                        <input type="checkbox" id="swal-wm-chk-transparent" style="width: 13px; height: 13px; cursor: pointer; margin: 0;">
                                        <span>透明</span>
                                    </label>
                                </div>
                                <div style="display: flex; gap: 4px; margin-top: 5px; flex-wrap: wrap;">
                                    ${colorSwatches.map(s => `<button type="button" class="swal-bg-swatch" data-color="${s.hex}" title="${s.label}" style="width: 16px; height: 16px; border-radius: 3px; border: 1px solid #64748b; background: ${s.hex}; cursor: pointer; padding: 0;"></button>`).join('')}
                                </div>
                            </div>
                        </div>

                        <div style="${cardStyle}">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                <label class="audit-form-label" style="font-weight: bold; margin: 0;">水印即時預覽：</label>
                                <span id="swal-wm-preview-status" style="font-size: 11px; color: #64748b;"></span>
                            </div>
                            <div style="border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden;">
                                <canvas id="swal-wm-preview-canvas" width="320" height="180" style="display: block; width: 100%; height: auto;"></canvas>
                            </div>
                        </div>
                    </div>
                </div>`,
            showCancelButton: true,
            confirmButtonText: '開始打包下載',
            cancelButtonText: '取消',
            focusConfirm: false,
            didOpen: () => {
                const enableChk = document.getElementById('swal-wm-enable');
                const panelEl = document.getElementById('swal-wm-options-panel');
                const pointChk = document.getElementById('swal-wm-chk-point');
                const timeChk = document.getElementById('swal-wm-chk-time');
                const prefixChk = document.getElementById('swal-wm-chk-prefix');
                const transparentChk = document.getElementById('swal-wm-chk-transparent');
                const posSelect = document.getElementById('swal-wm-pos');
                const sizeInput = document.getElementById('swal-wm-size');
                const fontColorInput = document.getElementById('swal-wm-font-color');
                const bgColorInput = document.getElementById('swal-wm-bg-color');

                const syncTransparentState = () => {
                    const isTrans = !!transparentChk?.checked;
                    if (bgColorInput) {
                        bgColorInput.disabled = isTrans;
                        bgColorInput.style.opacity = isTrans ? '0.4' : '1';
                    }
                    document.querySelectorAll('.swal-bg-swatch').forEach(btn => {
                        btn.disabled = isTrans;
                        btn.style.opacity = isTrans ? '0.4' : '1';
                    });
                    renderWatermarkPreview();
                };

                const togglePanel = () => {
                    const isChecked = !!enableChk?.checked;
                    if (panelEl) panelEl.style.display = isChecked ? 'block' : 'none';
                    if (isChecked) renderWatermarkPreview();
                };

                enableChk?.addEventListener('change', togglePanel);
                pointChk?.addEventListener('change', renderWatermarkPreview);
                timeChk?.addEventListener('change', renderWatermarkPreview);
                prefixChk?.addEventListener('change', renderWatermarkPreview);
                transparentChk?.addEventListener('change', syncTransparentState);
                posSelect?.addEventListener('change', renderWatermarkPreview);
                sizeInput?.addEventListener('input', renderWatermarkPreview);
                fontColorInput?.addEventListener('input', renderWatermarkPreview);
                bgColorInput?.addEventListener('input', renderWatermarkPreview);

                document.querySelectorAll('.swal-font-swatch').forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (fontColorInput) fontColorInput.value = btn.dataset.color;
                        renderWatermarkPreview();
                    });
                });

                document.querySelectorAll('.swal-bg-swatch').forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (transparentChk?.checked) {
                            transparentChk.checked = false;
                            syncTransparentState();
                        }
                        if (bgColorInput) bgColorInput.value = btn.dataset.color;
                        renderWatermarkPreview();
                    });
                });

                loadPreviewInBackground();
            },
            willClose: () => {
                isModalClosed = true;
            },
            preConfirm: () => {
                const enabled = document.getElementById('swal-wm-enable').checked;
                if (!enabled) {
                    return {
                        enabled: false,
                        showPoint: false,
                        showTime: false,
                        showPrefix: false,
                        transparentBg: false,
                        position: 'bottom-right',
                        fontSize: 20,
                        fontColor: '#ffffff',
                        bgColor: '#000000'
                    };
                }

                const showPoint = document.getElementById('swal-wm-chk-point').checked;
                const showTime = document.getElementById('swal-wm-chk-time').checked;
                const showPrefix = !!document.getElementById('swal-wm-chk-prefix')?.checked;
                const transparentBg = !!document.getElementById('swal-wm-chk-transparent')?.checked;
                const fontSize = parseInt(document.getElementById('swal-wm-size').value, 10);

                if (!showPoint && !showTime) {
                    Swal.showValidationMessage('已勾選加上浮水印，請至少勾選一項水印內容！');
                    return false;
                }
                if (!fontSize || fontSize < 1 || fontSize > 100) {
                    Swal.showValidationMessage('字體大小請輸入介於 1 到 100 之間的數字！');
                    return false;
                }

                return {
                    enabled: true,
                    showPoint,
                    showTime,
                    showPrefix,
                    transparentBg,
                    position: document.getElementById('swal-wm-pos').value,
                    fontSize,
                    fontColor: document.getElementById('swal-wm-font-color')?.value || '#ffffff',
                    bgColor: document.getElementById('swal-wm-bg-color')?.value || '#000000'
                };
            }
        });

        if (!watermarkSettings) return;

        let isCancelled = false;

        Swal.fire({
            title: '正在搜尋 Storage 照片...',
            html: `<div id="zip-progress-text" style="font-size:14px; margin-top:10px;">請稍候...</div>`,
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
            showCancelButton: true,
            cancelButtonText: '取消打包',
            cancelButtonColor: '#e74c3c',
            didOpen: () => {
                Swal.showLoading();
                const cancelBtn = Swal.getCancelButton();
                if (cancelBtn) {
                    cancelBtn.disabled = false;
                    cancelBtn.addEventListener('click', () => {
                        isCancelled = true;
                        cancelBtn.disabled = true;
                        cancelBtn.textContent = '正在取消...';
                    }, { once: true });
                }
            }
        });

        const progressEl = document.getElementById('zip-progress-text');

        try {
            const storageFolderPath = `${STORAGE_ROOT}/${cleanLayerName}`;
            const listResult = await firebase.storage().ref(storageFolderPath).listAll();
            if (isCancelled) return;

            if (listResult.items.length === 0) {
                return Swal.fire('提示', `Storage 路徑 [${storageFolderPath}] 下找不到任何檔案。`, 'info');
            }

            const items = listResult.items;
            if (progressEl) progressEl.textContent = `找到 ${items.length} 個檔案，準備下載並處理...`;

            const zip = new JSZip();
            const rootFolder = zip.folder(cleanLayerName);

            const targetPhotosCount = getSafeAuditConfig(kmlId).targetPhotos || 2;
            const csvData = buildCsvContent(kmlId, cleanLayerName, targetPhotosCount);
            rootFolder.file(`${cleanLayerName}_清查總表.csv`, csvData);

            const needWatermark = !!(watermarkSettings.enabled && (watermarkSettings.showPoint || watermarkSettings.showTime));
            const records = needWatermark ? (window.auditLayersState?.[kmlId] || {}) : {};
            let completedCount = 0, failCount = 0;

            const processSinglePhoto = async (fileRef) => {
                if (isCancelled) return;
                const downloadUrl = await fileRef.getDownloadURL();
                if (isCancelled) return;

                const response = await fetch(downloadUrl);
                if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                if (isCancelled) return;

                let imageBlob = await response.blob();
                if (isCancelled) return;

                if (needWatermark) {
                    const fileName = fileRef.name;
                    const parsedPointKey = fileName.replace(/_\d+\.[^/.]+$/, '').trim();
                    const record = records[parsedPointKey] || {};

                    let fallbackTimeStr = "";
                    if (record.updatedAt) {
                        try {
                            const dateObj = record.updatedAt.toDate ? record.updatedAt.toDate() : new Date(record.updatedAt);
                            if (!isNaN(dateObj.getTime())) {
                                fallbackTimeStr = dateObj.toLocaleString('sv', { timeZone: 'Asia/Taipei' });
                            }
                        } catch {}
                    }

                    const storageTime = await getStoragePhotoTime(fileRef, fallbackTimeStr);
                    if (isCancelled) return;

                    imageBlob = await addWatermarkToImage(imageBlob, {
                        showPoint: watermarkSettings.showPoint,
                        showTime: watermarkSettings.showTime,
                        showPrefix: watermarkSettings.showPrefix,
                        position: watermarkSettings.position,
                        customFontSize: watermarkSettings.fontSize,
                        fontColor: watermarkSettings.fontColor,
                        bgColor: watermarkSettings.bgColor,
                        transparentBg: watermarkSettings.transparentBg,
                        pointName: parsedPointKey,
                        photoTime: storageTime
                    });
                    if (isCancelled) return;
                }

                rootFolder.file(fileRef.name, imageBlob);
            };

            const BATCH_SIZE = 6;
            for (let i = 0; i < items.length; i += BATCH_SIZE) {
                if (isCancelled) break;
                const batch = items.slice(i, i + BATCH_SIZE);

                await Promise.all(batch.map(async (fileRef) => {
                    if (isCancelled) return;
                    try {
                        await processSinglePhoto(fileRef);
                    } catch {
                        if (!isCancelled) failCount++;
                    } finally {
                        if (!isCancelled) {
                            completedCount++;
                            if (progressEl) progressEl.textContent = `打包進度: (${completedCount}/${items.length})`;
                        }
                    }
                }));
            }

            if (isCancelled) {
                Swal.close();
                return Swal.fire({
                    icon: 'info',
                    title: '已取消打包',
                    timer: 1200,
                    showConfirmButton: false
                });
            }

            if (completedCount - failCount === 0) throw new Error('所有檔案下載皆失敗，請確認網路連線或 CORS 設定。');
            if (progressEl) progressEl.textContent = '檔案下載完成，正在產生 ZIP...';

            const zipBlob = await zip.generateAsync(
                {
                    type: 'blob',
                    compression: 'STORE'
                },
                (metadata) => {
                    if (isCancelled || !progressEl || typeof metadata.percent !== 'number') return;
                    progressEl.textContent = `正在產生 ZIP... ${Math.round(metadata.percent)}%`;
                }
            );

            if (isCancelled) return;

            saveAs(zipBlob, `${cleanLayerName}_Storage照片總集.zip`);

            Swal.fire({
                icon: failCount > 0 ? 'warning' : 'success',
                title: '打包下載完成！',
                text: failCount > 0 ? `成功打包 ${completedCount - failCount} 個檔案，失敗 ${failCount} 個` : `已成功下載 ${completedCount} 個照片檔案與 CSV 清冊`,
                timer: 2500,
                showConfirmButton: false
            });

        } catch (error) {
            if (isCancelled) return;
            Swal.fire({ icon: 'error', title: '打包失敗', text: error.message || '發生未知錯誤' });
        }
    };
        
    // ---------------------------------------------------------
    // 8. 監聽器與退場機制
    // ---------------------------------------------------------
    const initGlobalConfigListener = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) return setTimeout(initGlobalConfigListener, 500);

        firebase.firestore().collection(APP_PATH).onSnapshot(snapshot => {
            snapshot.forEach(doc => { 
                window.globalAuditConfigs[doc.id] = doc.data(); 
                startAuditDataListener(doc.id);
            });
            updateKmlSelectUI();
            forceMapRefresh();
        });
    };

    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        auditUnsubscribes[kmlId] = firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').onSnapshot(snapshot => {
            const updates = {};
            snapshot.forEach(doc => updates[doc.id] = doc.data());
            window.auditLayersState[kmlId] = updates;
            forceMapRefresh(); 
        });
    }

    window.cleanupAuditListeners = function() {
        Object.keys(auditUnsubscribes).forEach(key => {
            auditUnsubscribes[key]?.();
            delete auditUnsubscribes[key];
        });
    };

    function updateKmlSelectUI() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select) return;

        const hasPermission = checkHasAuditPermission();
        Array.from(select.options).forEach(opt => {
            if (!opt.value) return;
            const config = getSafeAuditConfig(opt.value);
            const baseName = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
            opt.setAttribute('data-basename', baseName);
            opt.textContent = (hasPermission && config?.isAuditing) ? `${baseName} (清查中:${config.targetPhotos}張)` : baseName;
        });
    }

    // ---------------------------------------------------------
    // 9. 地圖掛載與元件初始化
    // ---------------------------------------------------------
    let checkAttempts = 0;
    const checkMapInterval = setInterval(() => {
        if (window.mapNamespace?.map && typeof L !== 'undefined') {
            clearInterval(checkMapInterval);
            const map = window.mapNamespace.map;

            map.on('moveend zoomend resize', () => setTimeout(() => map.invalidateSize({ animate: false }), 100));

            const AuditMenu = L.Control.extend({
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                    return this._container;
                }
            });
            bottomControl = new AuditMenu();
            bottomControl.addTo(map);

            const YellowDotControl = L.Control.extend({
                options: { position: 'topright' },
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'leaflet-control-yellow-dot');
                    return this._container;
                }
            });
            yellowDotControl = new YellowDotControl();
            yellowDotControl.addTo(map);

            const ProgressControl = L.Control.extend({
                options: { position: 'topright' },
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'leaflet-control-audit-progress');
                    L.DomEvent.disableClickPropagation(this._container);
                    return this._container;
                }
            });
            progressControl = new ProgressControl();
            progressControl.addTo(map);
            
            initGlobalConfigListener();
        } else if (++checkAttempts >= 30) {
            clearInterval(checkMapInterval);
        }
    }, 500);  
    
    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged((user) => {
            if (user) setTimeout(() => window.forceMapRefresh?.(), 300);
        });
    }
    
})();
