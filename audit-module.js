/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (v4.5 效能優化與 ZIP 整合 CSV 版)
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
    // 📊 清查進度計算與黃點開關
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

    window.toggleAuditedPointsVisibility = function() {
        window.showAuditedPoints = !window.showAuditedPoints;
        forceMapRefresh();
        updateBottomBtnState();
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
                            f.properties.auditStatus = record.deviceStatus || "正常";
                            f.properties.fillColor = isAuditedVisible ? "#FCD770" : "transparent";
                            f.properties.fillOpacity = isAuditedVisible ? 0.85 : 0;
                            f.properties.opacity = isAuditedVisible ? 1 : 0;
                            f.properties.stroke = isAuditedVisible;
                            f.properties.weight = isAuditedVisible ? 2 : 0;
                            f.properties.color = isAuditedVisible ? "#ffffff" : "transparent"; 
                        } else {
                            f.properties.auditStatus = null;
                            f.properties.fillColor = "#2A00D2";
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
                        if (typeof layer.setStyle === 'function') {
                            layer.setStyle({
                                fillColor: isAuditedVisible ? "#FCD770" : "transparent",
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
                                fillColor: "#2A00D2",
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

    function initMapResizeObserver() {
        const map = window.mapNamespace?.map;
        if (map && !window._mapResizeObserver) {
            window._mapResizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }));
            window._mapResizeObserver.observe(map.getContainer());
        }
    }

    function forceMapRefresh() {
        const ns = window.mapNamespace;
        const map = ns?.map;
        const kmlId = ns?.currentKmlLayerId || window.currentActiveKmlId;
        if (!map || !kmlId) return;

        initMapResizeObserver();
        map.invalidateSize({ pan: false });

        if (typeof window.addGeoJsonLayers === 'function' && ns.allKmlFeatures) {
            window.addGeoJsonLayers(ns.allKmlFeatures);
        }

        syncAuditButtonVisibility();
        updateBottomBtnState();
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
                    <div class="audit-progress-card">
                        未清查: ${progress.remaining} / ${progress.total}
                    </div>`;
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
        container.style.cursor = 'crosshair';
        setAddButtonActiveState(true);
    
        Swal.mixin({ toast: true, position: 'top', showConfirmButton: false, timer: 4000, timerProgressBar: true })
            .fire({ icon: 'info', title: '📍 請在地圖上點擊要新增點位的實體位置' });
    
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
        let btn = document.getElementById('btn-standalone-add-point') || document.createElement('button');
        btn.id = 'btn-standalone-add-point';
        btn.innerHTML = '➕ 新增點位';
        if (!btn.parentNode) document.body.appendChild(btn);
    
        btn.onclick = (e) => { e.stopPropagation(); window.startAddCustomPoint(); };
        syncAuditButtonVisibility();
    })();
    
    window.handleAddPhotoPreview = function(input, index) {
        if (input.files?.[0]) {
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
        const map = window.mapNamespace?.map;
        if (map) window.preAuditMapState = { center: map.getCenter(), zoom: map.getZoom() };
        
        let kmlId, lat, lng, editData = null, isEditMode = false;
        if (typeof param1 === 'object' && param1 !== null) {
            editData = param1; kmlId = editData.kmlId; lat = editData.lat; lng = editData.lng; isEditMode = !!editData.isEditMode;
        } else {
            kmlId = param1; lat = param2; lng = param3;
        }

        if (!isAuditActiveForLayer(kmlId)) return;
    
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
                        <span>🖼️️</span> <span id="add-tag-text-${i}">${hasPhoto ? '已選取' : '圖庫'}</span>
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
                <textarea id="add-point-remark" placeholder="輸入備註事項..." class="audit-form-textarea">${safeEscape(defaultRemark)}</textarea>
            </div>
        </div>`;
    
        const { value: formValues } = await Swal.fire({
            html: modalHtml, showCancelButton: true, confirmButtonText: confirmBtnText, cancelButtonText: '取消',
            confirmButtonColor: '#2ecc71', cancelButtonColor: '#707a86', focusConfirm: false,
            didOpen: () => setPointAddBtnVisible(false),
            willClose: () => syncAuditButtonVisibility(),
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
    
            if (isEditMode && oldPointKey && oldPointKey !== trimmedPointKey) {
                delete window.auditLayersState?.[kmlId]?.[oldPointKey];
                if (ns?.allKmlFeatures) ns.allKmlFeatures = ns.allKmlFeatures.filter(f => getPointKey(f.properties) !== oldPointKey);
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(oldPointKey).delete();
            }
    
            const nowTime = new Date(); 
            const structuredData = {
                pointName: trimmedPointKey, 
                status: "已完成", 
                deviceStatus: deviceStatus || "新增", 
                auditStatus: deviceStatus || "新增",
                description: finalDesc, 
                desc: finalDesc,
                note: remark || "", 
                photos: photoUrls, 
                lat: numLat, 
                lng: numLng, 
                isCustomPoint: true, 
                updatedAt: nowTime 
            };
    
            window.auditLayersState ||= {};
            window.auditLayersState[kmlId] ||= {};
            window.auditLayersState[kmlId][trimmedPointKey] = structuredData;
    
            const newGeoJsonFeature = {
                type: "Feature",
                geometry: { type: "Point", coordinates: [numLng, numLat] },
                properties: {
                    name: trimmedPointKey, title: trimmedPointKey, kmlId, auditPointKey: trimmedPointKey,
                    isCustomPoint: true, isAudited: true, deviceStatus: deviceStatus || "新增", auditStatus: deviceStatus || "新增",
                    description: finalDesc, desc: finalDesc,
                    auditNote: remark || "", photos: photoUrls, fillColor: "#FCD770", color: "#ffffff", radius: 8, fillOpacity: 0.85
                }
            };
    
            if (ns) {
                ns.allKmlFeatures ||= [];
                const idx = ns.allKmlFeatures.findIndex(f => getPointKey(f.properties) === trimmedPointKey);
                if (idx >= 0) ns.allKmlFeatures[idx] = newGeoJsonFeature;
                else ns.allKmlFeatures.push(newGeoJsonFeature);
            }
    
            await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(trimmedPointKey).set(structuredData, { merge: true });
            await generateLayerCsvReport(kmlId, kmlLayerName || kmlId || 'default_layer', getSafeAuditConfig(kmlId).targetPhotos || 2);
    
            await Swal.fire({ icon: 'success', title: isEditMode ? '修改點位成功' : '新增清查點位成功', timer: 800, showConfirmButton: false });
            forceMapRefresh();
        } catch (e) {
            Swal.fire('錯誤', e.message || '儲存失敗', 'error');
        }
    };
    
    // ---------------------------------------------------------
    // 照片壓縮輔助函數：寬度固定 1920，高度按原比例自動縮放 (含自動記憶體釋放)
    // ---------------------------------------------------------
    async function compressImageToCanvas(source) {
        return new Promise((resolve) => {
            if (typeof source === 'string' && source.startsWith('http')) {
                return resolve(source);
            }

            const img = new Image();
            const isObjectUrl = typeof source !== 'string';
            const url = isObjectUrl ? URL.createObjectURL(source) : source;

            const cleanup = () => {
                if (isObjectUrl) {
                    try { URL.revokeObjectURL(url); } catch {}
                }
            };
            
            img.onload = () => {
                cleanup();
                const canvas = document.createElement('canvas');
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
                    resolve(blob || source);
                }, 'image/jpeg', 0.82);
            };
            
            img.onerror = () => {
                cleanup();
                resolve(source); 
            };
            
            img.src = url;
        });
    }

    // ---------------------------------------------------------
    // 照片上傳與點位刪除
    // ---------------------------------------------------------
    window.uploadPhotosToStorage = async function(photos, kmlId, pointKey, kmlLayerName) {
        if (!photos || !Array.isArray(photos) || !photos.length) return [];
        if (!firebase?.storage) throw new Error("Firebase Storage SDK 未載入");

        const targetLayerName = kmlLayerName || getLayerFolderName(kmlId);
        const storageRef = firebase.storage().ref();
        const safePointKey = String(pointKey || 'point').replace(/[/\\?%*:|"<>]/g, '_');

        return Promise.all(photos.map(async (photoData, index) => {
            if (!photoData) return '';
            if (typeof photoData === 'string' && !photoData.startsWith('data:image') && !photoData.startsWith('blob:') && !(photoData instanceof File || photoData instanceof Blob)) {
                return photoData;
            }

            const customStoragePath = `${STORAGE_ROOT}/${targetLayerName}/${safePointKey}_${String(index + 1).padStart(2, '0')}.jpg`;
            const ref = storageRef.child(customStoragePath);

            const compressedBlob = await compressImageToCanvas(photoData);
            await ref.put(compressedBlob);
            return await ref.getDownloadURL();
        }));
    };
    
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
    // 6. 清查資料彈窗 (編輯與查看 - 同步極速預覽修復)
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
                    <textarea id="swal-note" class="swal2-textarea audit-form-textarea">${safeEscape(currentNote)}</textarea>
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
            willClose: () => syncAuditButtonVisibility(),
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
    
                await Swal.fire({ icon: 'success', title: '更新成功', timer: 800, showConfirmButton: false });
                forceMapRefresh();
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
        const description = record.description || record.desc || '';
        const note = record.note || record.remark || '';
        const photos = Array.isArray(record.photos) ? record.photos.filter(p => p && p.trim() !== '') : [];

        let photoHtml = '';
        if (photos.length > 0) {
            photos.forEach((url, idx) => {
                const safeUrl = safeEscape(url);
                const encodedUrl = encodeURI(url);
                photoHtml += `
                    <div class="audit-photo-item-editor">
                        <div class="audit-photo-box-editor readonly-clickable" onclick="window.open('${encodedUrl}', '_blank')" title="點擊檢視原圖">
                            <img src="${safeUrl}" class="audit-photo-preview-img">
                        </div>
                        <div class="audit-photo-tag-editor" onclick="window.open('${encodedUrl}', '_blank')" title="點擊檢視原圖">
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
                    <div class="audit-form-group-inline">
                        <label class="audit-form-label">設備狀態</label>
                        <select class="swal2-input audit-form-select" disabled>
                            <option selected>${safeEscape(deviceStatus)}</option>
                        </select>
                    </div>

                    <div class="audit-form-group">
                        <label class="audit-form-label">現場照片 (共 ${photos.length} 張)</label>
                        <div class="audit-photo-grid-editor">
                            ${photoHtml}
                        </div>
                    </div>

                    <div class="audit-form-group">
                        <label class="audit-form-label">敘述 <span class="optional">(選填)</span></label>
                        <input type="text" class="swal2-input audit-form-input" value="${safeEscape(description)}" readonly placeholder="無敘述">
                    </div>

                    <div class="audit-form-group">
                        <label class="audit-form-label">備註事項 <span class="optional">(選填)</span></label>
                        <textarea class="swal2-textarea audit-form-textarea" readonly placeholder="無備註事項">${safeEscape(note)}</textarea>
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
    // 7-1. 水印壓製工具函數 (讀取 Storage 上傳時間，支援動態字體與位置)
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

    async function addWatermarkToImage(imageBlob, options = {}) {
        const { 
            showPoint = false, 
            showTime = false, 
            pointName = '', 
            photoTime = '', 
            position = 'bottom-right',
            customFontSize = 12 
        } = options;
        
        // 若兩項皆未勾選，直接回傳原圖
        if (!showPoint && !showTime) return imageBlob;

        return new Promise((resolve) => {
            const img = new Image();
            const url = URL.createObjectURL(imageBlob);

            img.onload = () => {
                URL.revokeObjectURL(url);

                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');

                // 1. 繪製原圖
                ctx.drawImage(img, 0, 0);

                // 2. 組立勾選的水印文字陣列
                const textLines = [];
                if (showPoint && pointName) {
                    textLines.push(`點號: ${pointName}`);
                }
                if (showTime && photoTime) {
                    textLines.push(`時間: ${photoTime}`);
                }

                if (textLines.length === 0) {
                    return canvas.toBlob(blob => resolve(blob || imageBlob), 'image/jpeg', 0.85);
                }

                // 3. 計算字型大小與邊距 (依自訂大小 baseFontSize 搭配照片寬度縮放)
                const baseFontSize = parseInt(customFontSize, 10) || 12;
                const scaleFactor = canvas.width / 1000; // 以 1000px 寬度為基準比例縮放
                const fontSize = Math.max(baseFontSize, Math.round(baseFontSize * scaleFactor)); 
                const padding = Math.max(6, Math.round(fontSize * 0.5));
                const lineHeight = Math.round(fontSize * 1.3);
                
                ctx.font = `bold ${fontSize}px sans-serif`;

                let maxTextWidth = 0;
                textLines.forEach(line => {
                    const metrics = ctx.measureText(line);
                    if (metrics.width > maxTextWidth) maxTextWidth = metrics.width;
                });

                const bgWidth = maxTextWidth + (padding * 2);
                const bgHeight = (lineHeight * textLines.length) + (padding * 1.2);
                const margin = Math.max(10, Math.round(canvas.width * 0.015));

                // 4. 計算水印邊框座標 (靠左下或靠右下)
                let x = (position === 'bottom-left') ? margin : (canvas.width - bgWidth - margin);
                let y = canvas.height - bgHeight - margin;

                // 5. 繪製黑色半透明底框
                ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(x, y, bgWidth, bgHeight, 6);
                } else {
                    ctx.rect(x, y, bgWidth, bgHeight);
                }
                ctx.fill();

                // 6. 繪製白色文字與陰影
                ctx.fillStyle = '#FFFFFF';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
                ctx.shadowBlur = 3;
                ctx.textBaseline = 'top';

                textLines.forEach((line, index) => {
                    ctx.fillText(line, x + padding, y + padding + (index * lineHeight));
                });

                // 7. 匯出 JPEG Blob
                canvas.toBlob((blob) => {
                    resolve(blob || imageBlob);
                }, 'image/jpeg', 0.85);
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(imageBlob);
            };

            img.src = url;
        });
    }

    // ---------------------------------------------------------
    // 7-2. 打包 Firebase Storage 照片 (全功能水印設定與 ZIP 打包)
    // ---------------------------------------------------------
    window.downloadAuditPhotosZip = async function(kmlId) {
        if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
            return Swal.fire('套件缺失', '請確保 HTML 已引入 JSZip 與 FileSaver 套件！', 'error');
        }

        if (!['owner', 'editor'].includes(getUserRole())) {
            return Swal.fire('權限不足', '只有 Editor 或 Owner 角色才能打包下載清查照片！', 'warning');
        }
    
        const cleanLayerName = getLayerFolderName(kmlId, kmlId);

        // 💡 包含：點號、時間、左下/右下、自訂字體大小
        const { value: watermarkSettings } = await Swal.fire({
            title: '📸 打包照片與水印設定',
            html: `
                <div style="text-align: left; font-size: 14px;" class="audit-form-container">
                    <div style="margin-bottom: 12px;">
                        <label class="audit-form-label" style="font-weight: bold; display: block; margin-bottom: 6px;">1. 水印內容：</label>
                        <div style="display: flex; gap: 20px; align-items: center; padding: 2px 0;">
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                                <input type="checkbox" id="swal-wm-chk-point" checked style="width: 18px; height: 18px; cursor: pointer;">
                                <span>點號名稱 (例: NVA015)</span>
                            </label>
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                                <input type="checkbox" id="swal-wm-chk-time" checked style="width: 18px; height: 18px; cursor: pointer;">
                                <span>拍攝/上傳時間</span>
                            </label>
                        </div>
                    </div>
                    <div style="margin-bottom: 12px;">
                        <label class="audit-form-label" style="font-weight: bold; display: block; margin-bottom: 6px;">2. 水印位置：</label>
                        <select id="swal-wm-pos" class="swal2-input audit-form-select" style="margin-top: 0; width: 100%;">
                            <option value="bottom-right" selected>↘ 靠右下角</option>
                            <option value="bottom-left">↙ 靠左下角</option>
                        </select>
                    </div>
                    <div>
                        <label class="audit-form-label" style="font-weight: bold; display: block; margin-bottom: 6px;">3. 水印字體大小 (px)：</label>
                        <input id="swal-wm-size" type="number" class="swal2-input audit-form-input" value="12" min="10" max="72" step="1" style="margin-top: 0; width: 100%; box-sizing: border-box;">
                    </div>
                </div>`,
            showCancelButton: true,
            confirmButtonText: '開始打包下載',
            cancelButtonText: '取消',
            focusConfirm: false,
            preConfirm: () => {
                const fontSize = parseInt(document.getElementById('swal-wm-size').value, 10);
                if (!fontSize || fontSize < 10 || fontSize > 72) {
                    Swal.showValidationMessage('字體大小請輸入介於 10 到 72 之間的數字！');
                    return false;
                }
                return {
                    showPoint: document.getElementById('swal-wm-chk-point').checked,
                    showTime: document.getElementById('swal-wm-chk-time').checked,
                    position: document.getElementById('swal-wm-pos').value,
                    fontSize: fontSize
                };
            }
        });

        if (!watermarkSettings) return;

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
            if (progressEl) progressEl.textContent = `找到 ${items.length} 個檔案，準備下載並處理水印...`;

            const zip = new JSZip();
            const rootFolder = zip.folder(cleanLayerName);
            
            // 打包 CSV 清冊入 ZIP 包
            const targetPhotosCount = getSafeAuditConfig(kmlId).targetPhotos || 2;
            const csvData = buildCsvContent(kmlId, cleanLayerName, targetPhotosCount);
            rootFolder.file(`${cleanLayerName}_清查總表.csv`, csvData);

            const records = window.auditLayersState?.[kmlId] || {};
            let completedCount = 0, failCount = 0;

            const BATCH_SIZE = 3;
            for (let i = 0; i < items.length; i += BATCH_SIZE) {
                const batch = items.slice(i, i + BATCH_SIZE);

                await Promise.all(batch.map(async (fileRef) => {
                    try {
                        const downloadUrl = await fileRef.getDownloadURL();
                        const response = await fetch(downloadUrl);
                        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                        
                        let imageBlob = await response.blob();

                        // 至少有勾選一項時，進行 Storage 時間讀取與水印壓製
                        if (watermarkSettings.showPoint || watermarkSettings.showTime) {
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

                            // 抓取 Storage 檔案上傳的時間
                            const storageTime = await getStoragePhotoTime(fileRef, fallbackTimeStr);

                            imageBlob = await addWatermarkToImage(imageBlob, {
                                showPoint: watermarkSettings.showPoint,
                                showTime: watermarkSettings.showTime,
                                position: watermarkSettings.position,
                                customFontSize: watermarkSettings.fontSize,
                                pointName: parsedPointKey,
                                photoTime: storageTime
                            });
                        }

                        rootFolder.file(fileRef.name, imageBlob);
                    } catch (err) {
                        failCount++;
                    } finally {
                        completedCount++;
                        if (progressEl) progressEl.textContent = `打包進度: (${completedCount}/${items.length})`;
                    }
                }));
            }

            if (completedCount - failCount === 0) throw new Error('所有檔案下載皆失敗，請確認網路連線或 CORS 設定。');
            if (progressEl) progressEl.textContent = '檔案下載與水印壓製完成，正在壓縮 ZIP...';

            saveAs(await zip.generateAsync({ type: 'blob' }), `${cleanLayerName}_Storage照片總集.zip`);

            Swal.fire({
                icon: failCount > 0 ? 'warning' : 'success',
                title: '打包下載完成！',
                text: failCount > 0 ? `成功打包 ${completedCount - failCount} 個檔案，失敗 ${failCount} 個` : `已成功壓製水印並下載 ${completedCount} 個照片檔案與 CSV 清冊`,
                timer: 2500,
                showConfirmButton: false
            });

        } catch (error) {
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
