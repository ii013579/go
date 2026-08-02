/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (v3.06 批次 ZIP 照片下載與效能增強版)
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

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ---------------------------------------------------------
    // 1. 樣式攔截器與強力重繪機制
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
                        f.properties.fillColor = "#FCD770"; // 粉紅色 (已清查)
                        f.properties.radius = 8;
                    } else {
                        f.properties.isAudited = false;
                        f.properties.auditStatus = null;
                        f.properties.fillColor = "#2A00D2"; // 藍色 (未清查)
                        f.properties.radius = 8;
                    }
                    f.properties.color = "#ffffff";
                    f.properties.fillOpacity = 0.85;
                } else {
                    f.properties.fillColor = "#e74c3c"; // 紅色 (預設)
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
                                fillColor: "#ff85c0",
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
                                fillColor: "#3498db",
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
    }

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

            // 💡 統一膠囊按鈕通用 Style（防黑框干擾、統一尺寸 shape、保留前景背景色）
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
            // 💡 移除黑色半透明背景 (rgba(0,0,0,0.6)) 與毛玻璃效果，改為透明容器
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
    // 3. CSV 總表生成 (新增經緯度欄位)
    // ---------------------------------------------------------
    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos) {
        console.log(`[CSV] 開始生成總表 - KML ID: ${kmlId}, LayerName: ${kmlLayerName}`);
        
        // 1. 取得狀態紀錄
        const activeKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        const records = (window.auditLayersState && window.auditLayersState[activeKmlId]) ? window.auditLayersState[activeKmlId] : {};
        const ns = window.mapNamespace;
        const features = ns?.allKmlFeatures || [];

        // 檔名解析輔助函式：只提取最後檔名 (如 "A110_01")，自動剔除路徑與副檔名
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

        // 2. 建立 CSV 標頭 (加入 經度、緯度)
        let headerArr = ["點名", "經度", "緯度", "設備狀態"];
        const photoCount = parseInt(maxPhotos) || 2;
        for (let i = 1; i <= photoCount; i++) headerArr.push(`照片${i}`);
        headerArr.push("備註");
        
        let csvContent = "\uFEFF" + headerArr.join(",") + "\n";

        // 建立點名與 Feature 的 Map 對照，方便搜尋座標
        const featureMap = new Map();
        if (Array.isArray(features)) {
            features.forEach(f => {
                const key = f.properties?.name || f.properties?.title || f.id;
                if (key) featureMap.set(String(key), f);
            });
        }

        // 3. 收集所有點位名稱 (去重)
        const allPointKeys = new Set();
        featureMap.forEach((_, key) => allPointKeys.add(key));
        Object.keys(records).forEach(key => {
            if (key) allPointKeys.add(String(key));
        });

        console.log(`[CSV] 預計處理點位總數: ${allPointKeys.size} 筆`);

        // 4. 組合內文
        allPointKeys.forEach(pointKey => {
            const record = records[pointKey]; 
            const feature = featureMap.get(pointKey);
            let rowArr = [];
            
            // 點名
            rowArr.push(`"${pointKey.replace(/"/g, '""')}"`);

            // --- 座標提取邏輯 ---
            let lng = "";
            let lat = "";

            // 優先從 record (手動新增/紀錄) 拿座標
            if (record && record.lng && record.lat) {
                lng = record.lng;
                lat = record.lat;
            } 
            // 備用：從原 KML feature 的 geometry 抓取
            else if (feature && feature.geometry && feature.geometry.coordinates) {
                const coords = feature.geometry.coordinates;
                // GeoJSON 格式通常為 [lng, lat]
                lng = coords[0] !== undefined ? coords[0] : "";
                lat = coords[1] !== undefined ? coords[1] : "";
            }

            rowArr.push(`"${lng}"`);
            rowArr.push(`"${lat}"`);

            // 設備狀態、照片與備註
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
                rowArr.push('""'); // 設備狀態空白
                for (let i = 0; i < photoCount; i++) rowArr.push('""');
                rowArr.push('""'); // 備註空白
            }

            csvContent += rowArr.join(",") + "\n";
        });

        // 5. 寫入 Firebase Storage
        try {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
            
            let rootPath = (typeof STORAGE_ROOT !== 'undefined' && STORAGE_ROOT) ? STORAGE_ROOT : 'kmldata-d22fb/storage';
            rootPath = rootPath.replace(/^\/+|\/+$/g, ''); 
            
            const safeLayerName = kmlLayerName || 'default_layer';
            const csvStoragePath = `${rootPath}/${safeLayerName}/${safeLayerName}_清查總表.csv`;

            console.log(`[CSV] 正在發送至 Firebase Storage 相對路徑: ${csvStoragePath}`);

            if (typeof firebase === 'undefined' || !firebase.storage) {
                throw new Error("Firebase Storage SDK 未初始化！");
            }

            const storageRef = firebase.storage().ref().child(csvStoragePath);
            const snapshot = await storageRef.put(blob, { contentType: 'text/csv' });
            
            console.log("✅ [CSV 成功] 已成功將清查總表寫入 Storage：", csvStoragePath);
            return snapshot;

        } catch (err) {
            console.error("❌ [CSV 失敗] 上傳失敗原因：", err);
            if (typeof window.downloadCsvFallback === 'function') {
                window.downloadCsvFallback(csvContent, `${kmlLayerName || '清查'}_總表.csv`);
            }
        }
    }

    // 瀏覽器本地下載備用機制
    window.downloadCsvFallback = function(csvData, filename) {
        console.warn("⚠️ 啟動本地 CSV 下載備用方案");
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
    // 4. 清查管理對話框 (整合單一頁面設定與 ZIP 打包按鈕)
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
            title: '圖層清查管理 (v3.06)', 
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
                // 1. 讀取先前儲存的選項，若無設定則給予預設值 (正常, 損壞, 遺失)
                const savedOptions = localStorage.getItem('audit_status_options');
                const defaultStatusStr = savedOptions 
                    ? JSON.parse(savedOptions).join(', ') 
                    : '正常, 損壞, 遺失';

                // 2. 單一彈窗頁面：同時設定照片張數與設備狀態
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

                        // 解析選項字串為陣列
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

                    // 儲存至本地快照 (LocalStorage)
                    localStorage.setItem('audit_status_options', JSON.stringify(options));

                    // 顯示 Loading 並同步寫入 Firestore 資料庫
                    Swal.fire({ title: '正在開啟清查...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                    
                    await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ 
                        isAuditing: true, 
                        targetPhotos: count,
                        statusOptions: options
                    }, { merge: true });
                    
                    Swal.fire({ icon: 'success', title: '已成功開啟清查模式', timer: 1200, showConfirmButton: false });
                } else {
                    window.showAuditActionModal();
                }
            } else {
                // 關閉清查模式
                Swal.fire({ title: '正在關閉清查...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ 
                    isAuditing: false 
                }, { merge: true });
                
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
       
// =========================================================
// 5.1 獨立區段：手動新增點位功能 & 底部按鈕 UI 渲染
// =========================================================

// 安全轉義字串 (防止 XSS)
const safeEscape = (str) => {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(str);
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// 確保全域有 escapeHtml 可呼叫
if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = safeEscape;
}

// 暫存挑選模式的清理函式，防止重複觸發殘留
let activeAddPointCleanup = null;

/**
 * 1. 觸發挑選位置模式 (點擊「新增點位」按鈕)
 */
window.startAddCustomPoint = function(kmlId) {
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

    // 若先前已在挑選模式，先清理舊事件
    if (activeAddPointCleanup) {
        activeAddPointCleanup();
    }

    // 修改滑鼠游標為十字準星
    const container = map.getContainer();
    container.style.cursor = 'crosshair';

    // 提示 Toast
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

    // 定義點擊處理函式
    const handleMapClick = async function(e) {
        cleanup();
        const { lat, lng } = e.latlng;
        await window.openAddPointModal(targetKmlId, lat, lng);
    };

    // 支援 ESC 鍵取消選擇模式
    const handleKeydown = function(e) {
        if (e.key === 'Escape') {
            cleanup();
            Swal.fire({ icon: 'info', title: '已取消新增點位', timer: 1000, showConfirmButton: false });
        }
    };

    // 定義清理作業
    const cleanup = () => {
        map.off('click', handleMapClick);
        document.removeEventListener('keydown', handleKeydown);
        container.style.cursor = '';
        activeAddPointCleanup = null;
    };

    activeAddPointCleanup = cleanup;

    // 綁定事件 (使用 on 搭配 cleanup 確保可隨時取消)
    map.on('click', handleMapClick);
    document.addEventListener('keydown', handleKeydown);
};

// =========================================================
// 5-2. 動態渲染獨立「新增點位」膠囊按鈕（固定於右下角）
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
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 6px !important;
        outline: none !important;
        line-height: 1.4 !important;
        white-space: nowrap !important;
    `);

    btn.onclick = function(e) {
        e.stopPropagation();
        if (typeof window.startAddCustomPoint === 'function') {
            window.startAddCustomPoint();
        }
    };
})();

// =========================================================
// 5-3. 彈窗 UI 介面與照片預覽 (採用原生 File Input 機制)
// =========================================================
window.openAddPointModal = async function(kmlId, lat, lng) {
    const maxPhotos = 2;
    let photoHtml = '';

    for (let i = 0; i < maxPhotos; i++) {
        photoHtml += `
            <div style="position:relative; margin-bottom:15px; width:80px;">
                <div style="border:2px dashed #ccc; height:80px; width:80px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:12px; overflow:hidden; cursor:pointer;">
                    <img id="add-prev-${i}" src="" style="width:100%; height:100%; object-fit:cover; display:none; position:absolute; top:0; left:0; z-index:1;">
                    <span id="add-icon-${i}" style="font-size:24px; color:#bbb; display:block; z-index:1;">📷</span>
                    <input type="file" id="add-photo-input-${i}" accept="image/*" capture="environment" onchange="window.handleAddPhotoPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;" title="現場拍照">
                </div>
                <label for="add-photo-input-${i}" style="position:absolute; left:50%; transform:translateX(-50%); bottom:-10px; z-index:3; background:#555; color:#fff; font-size:11px; padding:2px 8px; border-radius:12px; cursor:pointer; display:flex; align-items:center; gap:4px; box-shadow:0 2px 4px rgba(0,0,0,0.2); white-space:nowrap; border:1px solid #777;">
                    <span>🖼️</span> <span id="add-tag-text-${i}">圖庫</span>
                </label>
            </div>`;
    }

    const selectEl = document.getElementById('kmlLayerSelect');
    const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || kmlId;
    const kmlLayerName = rawLayerName.replace(/\.kml$/i, '').trim();

    const modalHtml = `
    <div style="text-align: left; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; padding: 0 5px;">
        <div style="text-align: center; font-size: 20px; font-weight: bold; color: #4a4a4a; margin-bottom: 20px; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <span style="color: #2ecc71; font-size: 24px; font-weight: 900;">➕</span>
            <span>新增點位清查紀錄</span>
        </div>
        <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 15px; font-weight: bold; color: #4a4a4a; margin-bottom: 8px;">
                點位名稱 / 點名 <span style="color: #e74c3c;">*必填</span>
            </label>
            <input type="text" id="add-point-name" placeholder="例如：新設電桿-01" style="width: 100%; padding: 10px 14px; font-size: 15px; border: 1px solid #dcdfe6; border-radius: 8px; outline: none; box-sizing: border-box; color: #333; background-color: #fff;">
        </div>
        <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 15px; font-weight: bold; color: #4a4a4a; margin-bottom: 8px;">設備狀態</label>
            <div style="width: 100%; padding: 10px 16px; font-size: 16px; font-weight: bold; color: #27ae60; background-color: #e8f8f5; border: 1px solid #a3e4d7; border-radius: 8px; box-sizing: border-box;">新增</div>
        </div>
        <div style="margin-bottom: 16px;">
            <label style="display: block; font-size: 15px; font-weight: bold; color: #4a4a4a; margin-bottom: 8px;">
                現場照片 (需拍 2 張) <span style="color: #e74c3c;">*必填</span>
            </label>
            <div style="display: flex; gap: 15px;">${photoHtml}</div>
        </div>
        <div style="margin-bottom: 0px;">
            <label style="display: block; font-size: 15px; font-weight: bold; color: #4a4a4a; margin-bottom: 8px;">
                備註事項 <span style="color: #909399; font-weight: normal;">(選填)</span>
            </label>
            <textarea id="add-point-remark" placeholder="輸入備註事項..." style="width: 100%; height: 80px; padding: 10px 14px; font-size: 15px; border: 1px solid #dcdfe6; border-radius: 8px; outline: none; box-sizing: border-box; resize: vertical; color: #333; font-family: inherit;"></textarea>
        </div>
    </div>`;

    const { value: formValues } = await Swal.fire({
        html: modalHtml,
        showCancelButton: true,
        confirmButtonText: '確認並新增上傳',
        cancelButtonText: '取消',
        confirmButtonColor: '#2ecc71',
        cancelButtonColor: '#707a86',
        buttonsStyling: true,
        customClass: {
            popup: 'custom-audit-modal-popup',
            confirmButton: 'custom-audit-confirm-btn',
            cancelButton: 'custom-audit-cancel-btn'
        },
        focusConfirm: false,
        preConfirm: () => {
            const name = document.getElementById('add-point-name').value.trim();
            const remark = document.getElementById('add-point-remark').value.trim();
            
            const fileInput0 = document.getElementById('add-photo-input-0');
            const fileInput1 = document.getElementById('add-photo-input-1');
            const photo0 = fileInput0 && fileInput0.files ? fileInput0.files[0] : null;
            const photo1 = fileInput1 && fileInput1.files ? fileInput1.files[0] : null;

            if (!name) {
                Swal.showValidationMessage('請填寫點位名稱！');
                return false;
            }
            if (!photo0 || !photo1) {
                Swal.showValidationMessage('請上傳完整 2 張現場照片！');
                return false;
            }

            return {
                kmlId: kmlId,
                kmlLayerName: kmlLayerName,
                lat: lat,
                lng: lng,
                pointKey: name,
                name: name,
                status: '新增',
                remark: remark,
                photos: [photo0, photo1]
            };
        }
    });

    if (formValues && typeof window.submitNewCustomPoint === 'function') {
        await window.submitNewCustomPoint(formValues);
    }
};

// 預覽輔助函式 (僅做 DOM 預覽，不影響原生 File 物件)
window.handleAddPhotoPreview = function(input, index) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
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
            if (tagText) tagText.innerText = '已選取';
        };
        reader.readAsDataURL(file);
    }
};

// =========================================================
// 5-4. 新增自訂點位送出邏輯 (與一般點位上傳與報表機制 100% 對齊)
// =========================================================
window.submitNewCustomPoint = async function(formValues) {
    const { kmlId, kmlLayerName, lat, lng, pointKey, status, remark, photos } = formValues;

    // 1. 顯示處理中彈窗
    Swal.fire({
        title: '正在處理並上傳資料...',
        didOpen: () => Swal.showLoading(),
        allowOutsideClick: false
    });

    try {
        // 2. 照片上傳至 Storage
        const uploadPromises = photos.map(async (photoData, i) => {
            if (!photoData) return '';

            if (typeof photoData === 'string' && photoData.startsWith('http')) {
                return photoData;
            }

            const photoIndexStr = String(i + 1).padStart(2, '0');
            const rootPath = typeof STORAGE_ROOT !== 'undefined' ? STORAGE_ROOT : 'audit_photos';
            const layerFolderName = kmlLayerName || kmlId;
            const customStoragePath = `${rootPath}/${layerFolderName}/${pointKey}_${photoIndexStr}.jpg`;

            const photoRef = firebase.storage().ref().child(customStoragePath);
            let blobToUpload;

            if (typeof photoData === 'string' && photoData.startsWith('data:image')) {
                blobToUpload = await (await fetch(photoData)).blob();
            } else if (photoData instanceof Blob || photoData instanceof File) {
                blobToUpload = photoData;
            } else {
                return '';
            }

            const metadata = { contentType: blobToUpload.type || 'image/jpeg' };
            await photoRef.put(blobToUpload, metadata);
            return await photoRef.getDownloadURL();
        });

        const photoUrls = await Promise.all(uploadPromises);

        // 3. 組裝標準資料結構
        const structuredData = {
            pointName: pointKey,
            status: "已完成",
            deviceStatus: status || "新增",
            note: remark || "",
            photos: photoUrls,
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            isCustomPoint: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        // 4. 更新前端狀態記憶體
        if (!window.auditLayersState) window.auditLayersState = {};
        if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
        window.auditLayersState[kmlId][pointKey] = structuredData;

        // 5. 寫入 Firestore 該圖層的 auditRecords 子集合
        const appPath = typeof APP_PATH !== 'undefined' ? APP_PATH : 'kmlData';
        await firebase.firestore()
            .collection(appPath)
            .doc(kmlId)
            .collection('auditRecords')
            .doc(pointKey)
            .set(structuredData, { merge: true });

        // 6. 自動重新產生圖層 CSV 報表
        if (typeof generateLayerCsvReport === 'function') {
            const maxPhotos = 2;
            await generateLayerCsvReport(kmlId, layerFolderName, maxPhotos);
        }

        // 7. 成功提示與地圖刷頁
        Swal.fire({
            icon: 'success',
            title: '新增清查點位成功',
            timer: 1000,
            showConfirmButton: false
        });

        if (typeof forceMapRefresh === 'function') forceMapRefresh();
        if (typeof updateBottomBtnState === 'function') setTimeout(updateBottomBtnState, 300);

    } catch (e) {
        console.error("❌ 新增清查點位失敗:", e);
        Swal.fire('錯誤', e.message || '新增失敗', 'error');
    }
};

// =========================================================
// 5-5. Firebase Storage 照片上傳處理 (通用工具函式)
// =========================================================
window.uploadPhotosToStorage = async function(photos, kmlId, pointKey) {
    if (!photos || !Array.isArray(photos) || photos.length === 0) {
        return [];
    }

    if (typeof firebase === 'undefined' || typeof firebase.storage !== 'function') {
        console.error("❌ Firebase Storage SDK 未載入！");
        throw new Error("Firebase Storage SDK 未載入，請確認網頁已引用 firebase-storage.js");
    }

    const storageRef = firebase.storage().ref();
    const uploadPromises = photos.map(async (photo, index) => {
        if (!photo || typeof photo === 'string') {
            return photo;
        }

        const fileExt = photo.name ? photo.name.split('.').pop() : 'jpg';
        const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');
        const fileName = `${safePointKey}_${Date.now()}_${index + 1}.${fileExt}`;
        
        const photoRef = storageRef.child(`audit_photos/${kmlId}/${fileName}`);

        try {
            const snapshot = await photoRef.put(photo);
            return await snapshot.ref.getDownloadURL();
        } catch (uploadError) {
            console.error(`❌ 照片 ${index + 1} 上傳失敗:`, uploadError);
            throw new Error(`照片 ${index + 1} 上傳失敗: ${uploadError.message}`);
        }
    });

    try {
        const urls = await Promise.all(uploadPromises);
        console.log("📸 照片成功上傳至 Storage:", urls);
        return urls;
    } catch (error) {
        console.error("❌ 照片批次上傳失敗:", error);
        throw error;
    }
};

// 通用按鈕輔助函式：產生統一膠囊風格按鈕
window.createUnifiedAuditButton = function(text, bgColor, onClickHandler) {
    const btn = document.createElement('button');
    btn.innerHTML = text;
    btn.style.cssText = `
        pointer-events: auto;
        background: ${bgColor};
        color: #ffffff;
        border: none;
        padding: 10px 22px;
        border-radius: 25px;
        font-weight: bold;
        font-size: 15px;
        box-shadow: 0 3px 10px rgba(0,0,0,0.25);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: transform 0.1s ease, box-shadow 0.1s ease;
        outline: none;
    `;
    btn.onclick = onClickHandler;
    return btn;
};

// 動態渲染底部選單 UI（包含：新增點位、清查點位、查看、修改）
window.updateAuditBottomMenuUI = function(mode, extraData) {
    if (typeof bottomControl === 'undefined' || !bottomControl || !bottomControl._container) return;

    const container = bottomControl._container;
    container.innerHTML = ''; // 清空內容

    const currentKmlId = window.currentActiveKmlId;
    if (!currentKmlId) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    container.style.alignItems = 'center';

    if (mode === 'VIEW_EDIT') {
        const viewBtn = window.createUnifiedAuditButton('查看', '#e91e63', () => {
            if (typeof window.openAuditDetailModal === 'function') {
                window.openAuditDetailModal(extraData);
            }
        });
        const editBtn = window.createUnifiedAuditButton('修改', '#f39c12', () => {
            if (typeof window.openAuditFormModal === 'function') {
                window.openAuditFormModal(extraData);
            }
        });

        container.appendChild(viewBtn);
        container.appendChild(editBtn);

    } else if (mode === 'AUDIT_MAIN') {
        const auditBtn = window.createUnifiedAuditButton('清查點位', '#2ecc71', () => {
            if (typeof window.openAuditFormModal === 'function') {
                window.openAuditFormModal(extraData);
            }
        });
        container.appendChild(auditBtn);

    } else {
        const addBtn = window.createUnifiedAuditButton('➕ 新增點位', '#2ecc71', () => {
            window.startAddCustomPoint(currentKmlId);
        });
        container.appendChild(addBtn);
    }
};

// =========================================================
// 5-6. 清查資料編輯與上傳邏輯
// =========================================================
window.openAuditEditor = async function(isModifyMode = false) {
    if (typeof checkHasAuditPermission === 'function' && !checkHasAuditPermission()) return;
    const activePoint = window.currentSelectedPoint;
    if (!activePoint) return;

    const layerProps = activePoint.feature?.properties || activePoint.properties || {};
    const pointKey = layerProps.name || layerProps.title || layerProps.id || "未知點位"; 
    const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId;
    const config = (window.globalAuditConfigs && window.globalAuditConfigs[kmlId]) || { targetPhotos: 2 };
    const maxPhotos = config.targetPhotos || 2;

    const selectEl = document.getElementById('kmlLayerSelect');
    const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '預設區域';
    const kmlLayerName = rawLayerName.replace(/\.kml$/i, '').trim(); 

    const historyRecord = isModifyMode ? (window.auditLayersState?.[kmlId]?.[pointKey] || {}) : {};
    const currentPhotos = Array.isArray(historyRecord.photos) ? [...historyRecord.photos] : new Array(maxPhotos).fill('');
    const currentStatus = historyRecord.deviceStatus || '';
    const currentNote = historyRecord.note || '';

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
                    
                    const prevEl = document.getElementById('audit-prev-' + index);
                    const iconEl = document.getElementById('audit-icon-' + index);
                    if (prevEl) { prevEl.src = base64; prevEl.style.display = 'block'; }
                    if (iconEl) { iconEl.style.display = 'none'; }
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
            <div style="position:relative; margin-bottom:20px;">
                <div style="border:2px dashed #ccc; height:85px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:8px; overflow:hidden; cursor:pointer;">
                    <img id="audit-prev-${i}" src="${photoData}" style="width:100%; height:100%; object-fit:cover; display:${photoData ? 'block' : 'none'}; position:absolute; top:0; left:0; z-index:1;">
                    <span id="audit-icon-${i}" style="font-size:24px; color:#bbb; display:${photoData ? 'none' : 'block'}; z-index:1;">📷</span>
                    <input type="file" accept="image/*" capture="environment" onchange="window._tempPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;" title="現場拍照">
                </div>
                <div style="position:absolute; left:50%; transform:translateX(-50%); bottom:-12px; z-index:3; background:#555; color:#fff; font-size:11px; padding:3px 10px; border-radius:12px; display:flex; align-items:center; gap:4px; box-shadow:0 2px 4px rgba(0,0,0,0.2); white-space:nowrap; border:1px solid #777;">
                    <span>🖼️</span> 舊檔
                </div>
            </div>`;
    }

    const layerConfig = window.globalAuditConfigs?.[kmlId] || {};
    const statusOptions = layerConfig.statusOptions || 
                          (localStorage.getItem('audit_status_options') ? JSON.parse(localStorage.getItem('audit_status_options')) : ['正常','損壞','遺失']);

    const statusOptionsHtml = statusOptions.map(opt => 
        `<option value="${opt}" ${currentStatus === opt ? 'selected' : ''}>${opt}</option>`
    ).join('');

    const { value: res } = await Swal.fire({
        title: `<div style="font-size:18px;">${isModifyMode ? '修改' : '填寫'}清查紀錄：${window.escapeHtml(pointKey)}</div>`,
        html: `<div style="text-align:left;">
            <label style="font-size:14px; font-weight:bold;">設備狀態 <span style="color:red;">*必選</span></label>
            <select id="swal-status" class="swal2-input" style="width:100%; margin:6px 0 16px 0;">
                <option value="" ${!currentStatus ? 'selected' : ''}>--- 請選擇設備狀態 ---</option>
                ${statusOptionsHtml}
            </select>

            <label style="font-size:14px; font-weight:bold;">現場照片 (需拍 ${maxPhotos} 張) <span style="color:red;">*必填</span></label>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(90px, 1fr)); gap:10px; margin:8px 0 16px 0;">
                ${photoHtml}
            </div>

            <label style="font-size:14px; font-weight:bold;">備註事項 <span style="color:#888; font-weight:normal;">(選填)</span></label>
            <textarea id="swal-note" class="swal2-textarea" style="width:100%; height:70px; margin:6px 0 0 0; resize:vertical;" placeholder="輸入備註事項...">${window.escapeHtml(currentNote)}</textarea>
        </div>`,
        showCancelButton: true,
        confirmButtonText: isModifyMode ? '覆蓋更新' : '確認並上傳',
        cancelButtonText: '取消',
        preConfirm: () => {
            const statusValue = document.getElementById('swal-status').value;
            if (!statusValue) { 
                Swal.showValidationMessage('請選擇設備狀態'); 
                return false; 
            }
            if (currentPhotos.filter(Boolean).length < maxPhotos) { 
                Swal.showValidationMessage(`請拍滿 ${maxPhotos} 張照片`); 
                return false; 
            }
            return { 
                status: statusValue, 
                note: document.getElementById('swal-note').value, 
                photos: currentPhotos 
            };
        }
    });

    delete window._tempPreview;
    
    if (res) {
        Swal.fire({ title: '正在處理並上傳資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        try {
            const rootPath = typeof STORAGE_ROOT !== 'undefined' ? STORAGE_ROOT : 'audit_photos';
            const uploadPromises = res.photos.map(async (data, i) => {
                if (data && data.startsWith('data:image')) {
                    const photoIndexStr = String(i + 1).padStart(2, '0');
                    const customStoragePath = `${rootPath}/${kmlLayerName}/${pointKey}_${photoIndexStr}.jpg`;
                    const ref = firebase.storage().ref().child(customStoragePath);
                    const blob = await (await fetch(data)).blob();
                    await ref.put(blob);
                    return await ref.getDownloadURL();
                }
                return data || '';
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

            const appPath = typeof APP_PATH !== 'undefined' ? APP_PATH : 'kmlData';
            await firebase.firestore()
                .collection(appPath)
                .doc(kmlId)
                .collection('auditRecords')
                .doc(pointKey) 
                .set(structuredData, { merge: true });
            
            if (typeof generateLayerCsvReport === 'function') {
                await generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos);
            }

            Swal.fire({ icon: 'success', title: '儲存成功', timer: 1000, showConfirmButton: false });
            
            if (typeof forceMapRefresh === 'function') forceMapRefresh();
            if (typeof updateBottomBtnState === 'function') setTimeout(updateBottomBtnState, 300);
        } catch (e) { 
            console.error("儲存清查資料失敗:", e);
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

    
    


    // ---------------------------------------------------------
    // 8.打包 Firebase Storage 照片 (直連原生 CORS 下載)
    // ---------------------------------------------------------
    window.downloadAuditPhotosZip = async function(kmlId, appId = 'default') {
        if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
            Swal.fire('套件缺失', '請確保 HTML 已引入 JSZip 與 FileSaver 套件！', 'error');
            return;
        }
    
        // 1. 權限檢查
        const rawRole = window.currentUserData?.role 
                     || window.currentUserRole 
                     || window.currentUser?.role;
        const userRole = rawRole?.toString().trim().toLowerCase();

        if (!['owner', 'editor'].includes(userRole)) {
            Swal.fire('權限不足', '只有 Editor 或 Owner 角色才能打包下載清查照片！', 'warning');
            return;
        }
    
        // 2. 抓取當前圖層名稱
        const selectEl = document.getElementById('kmlLayerSelect');
        let kmlLayerName = '';
        if (selectEl) {
            const opt = Array.from(selectEl.options).find(o => o.value === kmlId);
            if (opt) {
                const rawName = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
                kmlLayerName = rawName.trim();
            }
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
            const storage = firebase.storage();
            // 組合完整 Storage 路徑
            const storageFolderPath = `${STORAGE_ROOT}/${cleanLayerName}`;
            const folderRef = storage.ref(storageFolderPath);

            // 3. 列出目錄下所有檔案
            const listResult = await folderRef.listAll();

            if (listResult.items.length === 0) {
                Swal.fire('提示', `Storage 路徑 [${storageFolderPath}] 下找不到任何檔案。`, 'info');
                return;
            }

            const items = listResult.items;
            if (progressEl) progressEl.textContent = `找到 ${items.length} 個檔案，準備下載...`;

            const zip = new JSZip();
            const rootFolder = zip.folder(cleanLayerName);
            const csvRows = [['檔名', '完整 Storage 路徑', '下載網址']];

            let completedCount = 0;
            let failCount = 0;

            // 4. 分批拉取照片 (一次 3 個，避免併發過多)
            const BATCH_SIZE = 3;
            for (let i = 0; i < items.length; i += BATCH_SIZE) {
                const batch = items.slice(i, i + BATCH_SIZE);

                await Promise.all(batch.map(async (fileRef) => {
                    try {
                        const fileName = fileRef.name;
                        
                        // A. 取得 Firebase Storage 帶 token 的原始下載網址
                        const downloadUrl = await fileRef.getDownloadURL();

                        // B. 透過 Fetch 直連取得圖片 Blob（依靠剛設定好的 GCP CORS）
                        const response = await fetch(downloadUrl);
                        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                        const blob = await response.blob();

                        // C. 寫入 ZIP (直接傳入 Blob)
                        rootFolder.file(fileName, blob);

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

            // 6. 生成 ZIP 檔並下載
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            saveAs(zipBlob, `${cleanLayerName}_Storage照片總集.zip`);

            Swal.fire({
                icon: failCount > 0 ? 'warning' : 'success',
                title: '打包下載完成！',
                text: failCount > 0 
                    ? `成功打包 ${completedCount - failCount} 個檔案，失敗 ${failCount} 個`
                    : `已成功下載 ${completedCount} 個檔案與 CSV 清冊`,
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
        }, err => {
            console.warn("監聽根目錄圖層配置受限或中斷:", err.message);
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
                console.warn(`監聽子圖層 ${kmlId} 紀錄失敗:`, err.message);
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
    // 10. Leaflet 地圖初始化掛載 (輪詢檢查)
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
                    this._container.style.bottom = '35px'; // 統一底端高度
                    this._container.style.left = '50%';
                    this._container.style.transform = 'translateX(-50%)';
                    this._container.style.zIndex = '5000'; 
                    this._container.style.pointerEvents = 'none'; // 容器不擋地圖，僅按鈕可點擊
                    
                    // 💡 關鍵：去除原本黑色的外框背景與邊框Padding
                    this._container.style.background = 'transparent';
                    this._container.style.padding = '0';
                    this._container.style.boxShadow = 'none';
                    this._container.style.gap = '12px'; // 按鈕之間的間距
    
                    return this._container;
                }
            });
            bottomControl = new AuditMenu();
            bottomControl.addTo(window.mapNamespace.map);
            
            if (typeof initGlobalConfigListener === 'function') {
                initGlobalConfigListener();
            }
        } else if (checkAttempts >= maxAttempts) {
            clearInterval(checkMapInterval);
            console.warn("Leaflet 地圖載入逾時，停止清查選單初始化。");
        }
    }, 500);

})();
