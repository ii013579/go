/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (v4.1 完整修復版)
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

    // 全域安全轉義工具 (防止外部呼叫 safeEscape 報錯)
    function safeEscape(str) {
        if (str == null) return '';
        if (typeof str !== 'string') str = String(str);
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
    window.safeEscape = safeEscape;
    window.escapeHtml = safeEscape;

    // ---------------------------------------------------------
    // 共用輔助函式與權限判定
    // ---------------------------------------------------------
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
    // 1. 樣式攔截與重繪 (修復陣列污染、未清查點更新與 DOM 顯隱問題)
    // ---------------------------------------------------------
    (function hookAddGeoJsonLayers() {
        if (window.addGeoJsonLayers && window.addGeoJsonLayers.__isHooked) return;

        const originalAddLayers = window.addGeoJsonLayers;

        const newAddGeoJsonLayers = function(features) {
            const ns = window.mapNamespace;
            const kmlId = ns?.currentKmlLayerId || window.currentActiveKmlId;

            // 複製傳入陣列，避免修改到原始 features 造成資料重複污染
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
                        // 已清查點 (黃點) 控制
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
                        // 未清查點 (藍點) 控制 - 補上明確更新
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
    // 2. 底部控制按鈕與右上角元件
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

        // 1. 黃點切換按鈕
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

        // 2. 清查進度條
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

        // 3. 底部點位操作按鈕
        if (bottomControl?._container) {
            const active = window.currentSelectedPoint;
            if (active) {
                const layerProps = active.feature?.properties || active.properties || {};
                const pointKey = getPointKey(layerProps);
                const safePointKey = safeEscape(pointKey);
                const isAudited = (window.auditLayersState[kmlId] || {})[pointKey] !== undefined;

                const btnHtml = isAudited ? `
                    <button onclick="window.viewAuditDetailOnly('${safePointKey}')" class="audit-btn-action btn-view">🔍 查看</button>
                    <button onclick="window.openAuditEditor(true)" class="audit-btn-action btn-edit">✏️ 修改</button>
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
    // 3. CSV 報告生成
    // ---------------------------------------------------------
    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos) {
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

        new Set([...featureMap.keys(), ...Object.keys(records)]).forEach(pointKey => {
            if (!pointKey) return;
            const record = records[pointKey]; 
            const feature = featureMap.get(pointKey);
            let rowArr = [`"${pointKey.replace(/"/g, '""')}"`];

            rowArr.push(`"${record?.lng ?? feature?.geometry?.coordinates?.[0] ?? ""}"`);
            rowArr.push(`"${record?.lat ?? feature?.geometry?.coordinates?.[1] ?? ""}"`);

            if (record) {
                rowArr.push(`"${String(record.deviceStatus || record.status || '正常').replace(/"/g, '""')}"`);
                for (let i = 0; i < photoCount; i++) rowArr.push(`"${getCleanPhotoName(record.photos?.[i])}"`);
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
    // 4. 清查管理對話框與開關
    // ---------------------------------------------------------
    window.showAuditActionModal = async function() {
        if (!checkHasAuditPermission()) {
            return Swal.fire('權限不足', '您的帳號角色不允許管理清查狀態！', 'warning');
        }
        const select = document.getElementById('kmlLayerSelect');
        if (!select || select.options.length <= 1) return;

        let listHtml = '<div class="audit-action-list">';
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
                        ${isAuditing ? `<button onclick="window.downloadAuditPhotosZip('${safeValue}')" class="audit-btn-small audit-btn-zip">下載照片</button>` : ''}
                        <button onclick="window.toggleAuditStatus('${safeValue}', ${!isAuditing})" class="audit-btn-small ${isAuditing ? 'audit-btn-toggle-on' : 'audit-btn-toggle-off'}">
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
                        isAuditing: true, targetPhotos: formValues.count, statusOptions: formValues.options
                    }, { merge: true });
                    
                    window.globalAuditConfigs[kmlId] ||= {};
                    window.globalAuditConfigs[kmlId].isAuditing = true;

                    forceMapRefresh();
                    Swal.fire({ icon: 'success', title: '已成功開啟清查模式', timer: 1200, showConfirmButton: false });
                } else {
                    window.showAuditActionModal();
                }
            } else {
                Swal.fire({ title: '正在關閉清查...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: false }, { merge: true });
                
                window.globalAuditConfigs[kmlId] ||= {};
                window.globalAuditConfigs[kmlId].isAuditing = false;

                forceMapRefresh();
                Swal.fire({ icon: 'success', title: '已關閉清查模式', timer: 1000, showConfirmButton: false });
            }
        } catch (error) {
            Swal.fire({ icon: 'error', title: '同步失敗', text: error.message }).then(() => window.showAuditActionModal());
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
                        <span>🖼️</span> <span id="add-tag-text-${i}">${hasPhoto ? '已選取' : '圖庫'}</span>
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
            <div class="audit-form-group">
                <label class="audit-form-label">點位名稱 / 點名 <span class="required">*必填</span></label>
                <input type="text" id="add-point-name" value="${defaultName}" placeholder="例如：新設電桿-01" class="audit-form-input">
            </div>
            <div class="audit-form-group">
                <label class="audit-form-label">設備狀態</label>
                <select id="add-device-status" disabled class="audit-form-select">
                    <option value="新增" selected>新增</option>
                </select>
            </div>
            <div class="audit-form-group">
                <label class="audit-form-label">現場照片 (需拍 ${maxPhotos} 張) <span class="required">*必填</span></label>
                <div class="audit-photo-grid">${photoHtml}</div>
            </div>
            <div>
                <label class="audit-form-label">備註事項 <span class="optional">(選填)</span></label>
                <textarea id="add-point-remark" placeholder="輸入備註事項..." class="audit-form-textarea">${defaultRemark}</textarea>
            </div>
        </div>`;
    
        const { value: formValues } = await Swal.fire({
            html: modalHtml, showCancelButton: true, confirmButtonText: confirmBtnText, cancelButtonText: '取消',
            confirmButtonColor: '#2ecc71', cancelButtonColor: '#707a86', focusConfirm: false,
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

                const ns = window.mapNamespace;
                const currentRecords = window.auditLayersState?.[kmlId] || {};
                if (!isEditMode || (isEditMode && defaultName !== name)) {
                    if (ns?.allKmlFeatures?.some(f => getPointKey(f.properties) === name) || currentRecords[name]) {
                        return Swal.showValidationMessage(`點名「${name}」已存在，請修改點位名稱！`);
                    }
                }

                if (photosArray.length < maxPhotos) return Swal.showValidationMessage(`請上傳完整 ${maxPhotos} 張現場照片！`);
    
                return { kmlId, kmlLayerName, lat, lng, pointKey: name, name, status: "新增", deviceStatus: "新增", remark, photos: photosArray, isEditMode, oldPointKey: isEditMode ? defaultName : null };
            }
        });
    
        if (formValues && typeof window.submitNewCustomPoint === 'function') {
            await window.submitNewCustomPoint(formValues);
            forceMapRefresh();
        }
    };
    
    window.submitNewCustomPoint = async function(formValues) {
        const { kmlId, kmlLayerName, lat, lng, pointKey, deviceStatus, remark, photos, isEditMode, oldPointKey } = formValues;
        const trimmedPointKey = (pointKey || '').trim();
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
    
            const structuredData = {
                pointName: trimmedPointKey, status: "已完成", deviceStatus: deviceStatus || "新增", auditStatus: deviceStatus || "新增",
                note: remark || "", photos: photoUrls, lat: numLat, lng: numLng, isCustomPoint: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
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
            if (typeof photoData === 'string' && !photoData.startsWith('data:image')) return photoData;

            const customStoragePath = `${STORAGE_ROOT}/${targetLayerName}/${safePointKey}_${String(index + 1).padStart(2, '0')}.jpg`;
            const ref = storageRef.child(customStoragePath);

            let blob = photoData;
            if (typeof photoData === 'string' && photoData.startsWith('data:image')) {
                blob = await (await fetch(photoData)).blob();
            } else if (!(photoData instanceof File || photoData instanceof Blob)) {
                return photoData;
            }

            await ref.put(blob);
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
    // 6. 清查資料編輯與彈窗
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
                <label class="audit-form-label">備註事項 <span class="optional">(選填)</span></label>
                <textarea id="swal-note" class="swal2-textarea audit-form-textarea">${safeEscape(currentNote)}</textarea>
            </div>`,
            showCancelButton: true, showDenyButton: isUserCreatedPoint, denyButtonText: '🗑️ 刪除點位', denyButtonColor: '#e74c3c',
            confirmButtonText: isModifyMode ? '覆蓋更新' : '確認並上傳', cancelButtonText: '取消',
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
                                
                                const prevEl = document.getElementById(`audit-prev-${index}`);
                                const iconEl = document.getElementById(`audit-icon-${index}`);
                                const tagEl = document.getElementById(`audit-tag-${index}`);
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
                    modalEl.querySelector(`#audit-file-input-${i}`)?.addEventListener('change', (e) => handlePhotoChange(e.target, i));
                    modalEl.querySelector(`#audit-gallery-input-${i}`)?.addEventListener('change', (e) => handlePhotoChange(e.target, i));
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
    
        if (isDenied) return window.deleteCustomPoint(kmlId, pointKey, kmlLayerName);
    
        if (res) {
            Swal.fire({ title: '正在上傳與更新資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const photoUrls = await window.uploadPhotosToStorage(res.photos, kmlId, pointKey, kmlLayerName);
                const structuredData = {
                    pointName: pointKey, status: "已完成", deviceStatus: res.status, 
                    note: res.note, photos: photoUrls, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
    
                window.auditLayersState ||= {};
                window.auditLayersState[kmlId] ||= {};
                window.auditLayersState[kmlId][pointKey] = structuredData;
    
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pointKey).set(structuredData, { merge: true });
                await generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos);
    
                await Swal.fire({ icon: 'success', title: '更新成功', timer: 800, showConfirmButton: false });
                forceMapRefresh();
            } catch (e) { 
                Swal.fire('錯誤', e.message || '儲存失敗', 'error'); 
            }
        }
    };
      
    // ---------------------------------------------------------
    // 7. 詳細紀錄與批次打包下載 (修復 KML ID Fallback 與雙軌照片收集機制)
    // ---------------------------------------------------------
    window.viewAuditDetailOnly = function(pointKey) {
        const kmlId = window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        const record = window.auditLayersState?.[kmlId]?.[pointKey];
        if (!record) {
            return Swal.fire('提示', '找不到該點位的清查紀錄', 'warning');
        }
    
        let photoList = [];
        if (Array.isArray(record.photos)) {
            photoList = record.photos;
        } else if (record.photos && typeof record.photos === 'object') {
            photoList = Object.values(record.photos);
        }
    
        photoList = photoList.filter(url => url && typeof url === 'string');
    
        const photosHtml = photoList.length > 0
            ? photoList.map((url, idx) => `
                <div class="audit-photo-item-editor">
                    <div class="audit-photo-box-editor">
                        <img src="${safeEscape(url)}" class="audit-detail-img" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" onclick="window.open('${safeEscape(url)}', '_blank')">
                    </div>
                    <span class="audit-photo-tag-editor">照片 ${idx + 1}</span>
                </div>
            `).join('')
            : `<div style="color:#94a3b8; font-size:14px; padding:4px;">無現場照片</div>`;
    
        Swal.fire({
            title: `查看清查紀錄：${safeEscape(pointKey)}`,
            html: `
                <div class="audit-form-container">
                    <div class="audit-form-group-inline">
                        <label class="audit-form-label">設備狀態</label>
                        <input type="text" class="audit-form-input" value="${safeEscape(record.deviceStatus || record.status || '正常')}" style="font-weight:600; color:#2c3e50;" readonly disabled>
                    </div>
    
                    <div class="audit-form-group">
                        <label class="audit-form-label">現場照片 (${photoList.length} 張)</label>
                        <div class="audit-photo-grid-editor">
                            ${photosHtml}
                        </div>
                    </div>
    
                    <div class="audit-form-group">
                        <label class="audit-form-label">備註事項</label>
                        <textarea class="audit-form-textarea" readonly disabled>${safeEscape(record.note || record.remark || '無')}</textarea>
                    </div>
                </div>
            `,
            confirmButtonText: '關閉'
        });
    };

    window.downloadAuditPhotosZip = async function(kmlId) {
        if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') return Swal.fire('套件缺失', '缺少 JSZip / FileSaver 套件', 'error');
        if (!checkHasAuditPermission()) return Swal.fire('權限不足', '您的帳號角色權限受限！', 'warning');

        const targetKmlId = kmlId || window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        const cleanLayerName = getLayerFolderName(targetKmlId, targetKmlId);
        
        Swal.fire({ title: '正在收集照片網址...', html: `<div id="zip-progress-text" style="font-size:14px; margin-top:10px;">請稍候...</div>`, allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        const progressEl = document.getElementById('zip-progress-text');
        try {
            let downloadItems = []; // { name: string, url: string }

            // 1. 優先從記憶體狀態 (auditLayersState) 收集照片
            const records = window.auditLayersState?.[targetKmlId] || {};
            Object.entries(records).forEach(([ptKey, rec]) => {
                let photos = [];
                if (Array.isArray(rec.photos)) photos = rec.photos;
                else if (rec.photos && typeof rec.photos === 'object') photos = Object.values(rec.photos);

                photos.filter(u => typeof u === 'string' && u).forEach((url, i) => {
                    downloadItems.push({
                        name: `${ptKey}_照片${i + 1}.jpg`,
                        url: url
                    });
                });
            });

            // 2. 若記憶體無紀錄，則對 Storage 做遞迴目錄搜尋
            if (downloadItems.length === 0 && typeof firebase !== 'undefined' && firebase.storage) {
                const rootRef = firebase.storage().ref(`${STORAGE_ROOT}/${cleanLayerName}`);
                
                async function fetchAllFiles(ref) {
                    let files = [];
                    const res = await ref.listAll();
                    files.push(...res.items);
                    for (const folderRef of res.prefixes) {
                        const subFiles = await fetchAllFiles(folderRef);
                        files.push(...subFiles);
                    }
                    return files;
                }

                const items = await fetchAllFiles(rootRef);
                for (const item of items) {
                    const url = await item.getDownloadURL();
                    downloadItems.push({ name: item.name, url: url });
                }
            }

            if (downloadItems.length === 0) return Swal.fire('提示', '找不到任何照片檔案', 'info');

            const zip = new JSZip(), rootFolder = zip.folder(cleanLayerName);
            let completedCount = 0, failCount = 0;

            // 分批下載照片 (每批 3 個請求)
            for (let i = 0; i < downloadItems.length; i += 3) {
                const batch = downloadItems.slice(i, i + 3);
                await Promise.all(batch.map(async (item) => {
                    try {
                        const response = await fetch(item.url);
                        if (!response.ok) throw new Error();
                        rootFolder.file(item.name, await response.blob());
                    } catch { failCount++; } 
                    finally {
                        completedCount++;
                        if (progressEl) progressEl.textContent = `打包進度: (${completedCount}/${downloadItems.length})`;
                    }
                }));
            }

            if (completedCount - failCount === 0) throw new Error('所有照片下載皆失敗');
            saveAs(await zip.generateAsync({ type: 'blob' }), `${cleanLayerName}_清查照片總集.zip`);

            Swal.fire({ icon: failCount > 0 ? 'warning' : 'success', title: '打包下載完成！', timer: 2500, showConfirmButton: false });
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