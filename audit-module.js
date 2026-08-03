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
function safeEscape(str) {
    if (str === null || str === undefined) return '';
    if (typeof str === 'number' || typeof str === 'boolean') return String(str);
    if (typeof str !== 'string') {
        try {
            return JSON.stringify(str); // 若傳入物件，轉成字串避免遞迴呼叫
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
// 5-4. 新增/修改自訂點位送出邏輯 (對齊 5-6 規格版)
// =========================================================
window.submitNewCustomPoint = async function(formValues) {
    const { kmlId, kmlLayerName, lat, lng, pointKey, status, remark, photos, isEditMode, oldPointKey } = formValues;

    // 1. 點位名稱去除前後空白
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
    const currentRecords = (window.auditLayersState && window.auditLayersState[kmlId]) 
        ? window.auditLayersState[kmlId] 
        : {};

    // =========================================================
    // ✨【名稱防重檢核】：重複時警告並停留畫面，照片與輸入內容完好保留
    // =========================================================
    if (!isEditMode || (isEditMode && oldPointKey !== trimmedPointKey)) {
        let isDuplicateInKml = false;
        if (ns && Array.isArray(ns.allKmlFeatures)) {
            isDuplicateInKml = ns.allKmlFeatures.some(f => {
                const name = f.properties?.name || f.properties?.title || f.properties?.auditPointKey;
                return name === trimmedPointKey;
            });
        }
        const isDuplicateInState = !!currentRecords[trimmedPointKey];

        if (isDuplicateInKml || isDuplicateInState) {
            Swal.fire({
                icon: 'warning',
                title: '點位名稱重複',
                text: `點名「${trimmedPointKey}」已存在！請直接修改點位名稱後重新送出（剛拍的照片會保留）。`,
                confirmButtonText: '返回修改點名'
            });
            return; // ⛔ 立即中斷 Modal 與拍照內容完整保留
        }
    }

    // =========================================================
    // 2. 檢核通過，開始上傳照片與儲存資料
    // =========================================================
    Swal.fire({
        title: '正在處理並儲存資料...',
        didOpen: () => Swal.showLoading(),
        allowOutsideClick: false
    });

    try {
        // (A) ✨傳入 kmlLayerName，完全對齊 5-6 的 Storage 命名邏輯 (_01.jpg)
        let photoUrls = [];
        if (typeof window.uploadPhotosToStorage === 'function') {
            photoUrls = await window.uploadPhotosToStorage(photos, kmlId, trimmedPointKey, kmlLayerName);
        } else {
            console.warn("⚠️ 找不到 uploadPhotosToStorage，使用原始照片連結");
            photoUrls = Array.isArray(photos) ? photos.filter(p => typeof p === 'string') : [];
        }

        // (B) 若為編輯模式且變更了點名，刪除舊點位的紀錄
        if (isEditMode && oldPointKey && oldPointKey !== trimmedPointKey) {
            if (window.auditLayersState && window.auditLayersState[kmlId]) {
                delete window.auditLayersState[kmlId][oldPointKey];
            }
            if (ns && Array.isArray(ns.allKmlFeatures)) {
                ns.allKmlFeatures = ns.allKmlFeatures.filter(f => {
                    const name = f.properties?.name || f.properties?.title || f.properties?.auditPointKey;
                    return name !== oldPointKey;
                });
            }
            // 刪除 Firestore 舊文件
            const appPath = typeof APP_PATH !== 'undefined' ? APP_PATH : 'kmlData';
            await firebase.firestore().collection(appPath).doc(kmlId).collection('auditRecords').doc(oldPointKey).delete();
        }

        // (C) 組裝標準清查資料結構 (寫入快取記憶體)
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

        // (D) 更新 GeoJSON Feature 全域快取 (標記為已清查顏色)
        const newGeoJsonFeature = {
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [numLng, numLat]
            },
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
                fillColor: "#FCD770", // 已清查粉/黃顏色
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

        // (E) 寫入 Firestore 該圖層的 auditRecords 子集合
        const appPath = typeof APP_PATH !== 'undefined' ? APP_PATH : 'kmlData';
        await firebase.firestore()
            .collection(appPath)
            .doc(kmlId)
            .collection('auditRecords')
            .doc(trimmedPointKey)
            .set(structuredData, { merge: true });

        // (F) 重新產生圖層 CSV 報表
        const layerFolderName = kmlLayerName || kmlId || 'default_layer';
        if (typeof generateLayerCsvReport === 'function') {
            await generateLayerCsvReport(kmlId, layerFolderName, 2);
        }

        // (G) 顯示成功提示
        Swal.fire({
            icon: 'success',
            title: isEditMode ? '修改點位成功' : '新增清查點位成功',
            timer: 1200,
            showConfirmButton: false
        });

        // (H) 觸發地圖全域重繪與按鈕狀態刷新
        if (typeof forceMapRefresh === 'function') forceMapRefresh();
        if (typeof updateBottomBtnState === 'function') setTimeout(updateBottomBtnState, 300);

    } catch (e) {
        console.error("❌ 儲存點位失敗:", e);
        Swal.fire('錯誤', e.message || '儲存失敗', 'error');
    }
};

// =========================================================
// 5-5. Firebase Storage 照片上傳處理 (通用工具函式 & UI 選單)
// =========================================================

/**
 * 1. Firebase Storage 照片上傳處理 (對齊 5-6 標準規格)
 */
window.uploadPhotosToStorage = async function(photos, kmlId, pointKey, kmlLayerName) {
    if (!photos || !Array.isArray(photos) || photos.length === 0) {
        return [];
    }

    if (typeof firebase === 'undefined' || typeof firebase.storage !== 'function') {
        console.error("❌ Firebase Storage SDK 未載入！");
        throw new Error("Firebase Storage SDK 未載入，請確認網頁已引用 firebase-storage.js");
    }

    // (A) 取得根目錄名稱與圖層目錄名稱 (與 5-6 相同)
    const rootPath = typeof STORAGE_ROOT !== 'undefined' ? STORAGE_ROOT : 'audit_photos';
    
    // 若未傳入 kmlLayerName，嘗試從下拉選單取得
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
        // 若已經是 HTTP/HTTPS 上傳好的網址，直接傳回
        if (typeof photoData === 'string' && !photoData.startsWith('data:image')) {
            return photoData;
        }

        // 檔名流水號對齊 5-6 格式：pointKey_01.jpg
        const photoIndexStr = String(index + 1).padStart(2, '0');
        const customStoragePath = `${rootPath}/${targetLayerName}/${safePointKey}_${photoIndexStr}.jpg`;
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

    try {
        const urls = await Promise.all(uploadPromises);
        console.log("📸 照片成功上傳至 Storage:", urls);
        return urls;
    } catch (error) {
        console.error("❌ 照片批次上傳失敗:", error);
        throw error;
    }
};

/**
 * 2. 通用按鈕輔助函式：產生統一膠囊風格按鈕
 */
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

/**
 * 3. 刪除自訂點位 (同步刪除符合 5-6 規格的 Storage 照片與 Firestore 紀錄)
 */
window.deleteCustomPoint = async function(kmlId, pointKey, kmlLayerName) {
    if (!kmlId || !pointKey) {
        Swal.fire('錯誤', '無效的點位資訊，無法刪除', 'error');
        return;
    }

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

    Swal.fire({
        title: '正在刪除點位與照片...',
        didOpen: () => Swal.showLoading(),
        allowOutsideClick: false
    });

    try {
        const rootPath = typeof STORAGE_ROOT !== 'undefined' ? STORAGE_ROOT : 'audit_photos';
        let targetLayerName = kmlLayerName;
        if (!targetLayerName) {
            const selectEl = document.getElementById('kmlLayerSelect');
            const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || window.currentActiveKmlName || '預設區域';
            targetLayerName = rawLayerName.replace(/\.kml$/i, '').trim();
        }

        const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');
        const storageRef = firebase.storage().ref();

        // 嘗試刪除 01, 02... 格式照片
        const deletePhotoPromises = [1, 2, 3].map(async (i) => {
            const photoIndexStr = String(i).padStart(2, '0');
            const customStoragePath = `${rootPath}/${targetLayerName}/${safePointKey}_${photoIndexStr}.jpg`;
            try {
                await storageRef.child(customStoragePath).delete();
            } catch (err) {
                // 忽略不存在照片的錯誤
            }
        });
        await Promise.all(deletePhotoPromises);

        // 刪除 Firestore auditRecords 文件
        const appPath = typeof APP_PATH !== 'undefined' ? APP_PATH : 'kmlData';
        await firebase.firestore()
            .collection(appPath)
            .doc(kmlId)
            .collection('auditRecords')
            .doc(pointKey)
            .delete();

        // 清除全域記憶體與 GeoJSON Features 快取
        if (window.auditLayersState && window.auditLayersState[kmlId]) {
            delete window.auditLayersState[kmlId][pointKey];
        }

        const ns = window.mapNamespace;
        if (ns && Array.isArray(ns.allKmlFeatures)) {
            ns.allKmlFeatures = ns.allKmlFeatures.filter(f => {
                const name = f.properties?.name || f.properties?.title || f.properties?.auditPointKey;
                return name !== pointKey;
            });
        }

        // 清除點位選取狀態並重新產出 CSV
        window.currentSelectedPoint = null;
        if (typeof generateLayerCsvReport === 'function') {
            await generateLayerCsvReport(kmlId, targetLayerName, 2);
        }

        Swal.fire({
            icon: 'success',
            title: '已順利刪除點位',
            timer: 1200,
            showConfirmButton: false
        });

        // 刷新地圖與 UI
        if (typeof forceMapRefresh === 'function') forceMapRefresh();
        if (typeof updateBottomBtnState === 'function') setTimeout(updateBottomBtnState, 300);

    } catch (e) {
        console.error("❌ 刪除點位失敗:", e);
        Swal.fire('錯誤', e.message || '刪除失敗', 'error');
    }
};

/**
 * 4. 動態渲染底部選單 UI（包含：新增點位、清查點位、查看、修改、刪除）
 */
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
    container.style.gap = '8px';

    // ✨ 強化判斷：從多種可能的位置解析出 properties 與 isCustomPoint
    const props = extraData?.feature?.properties || extraData?.properties || extraData || {};
    const isCustom = !!(props.isCustomPoint || extraData?.isCustomPoint);

    if (mode === 'VIEW_EDIT') {
        // 1. 查看按鈕
        const viewBtn = window.createUnifiedAuditButton('查看', '#e91e63', () => {
            if (typeof window.openAuditDetailModal === 'function') {
                window.openAuditDetailModal(extraData);
            }
        });
        container.appendChild(viewBtn);

        // 2. 修改按鈕 (分流自訂點位與一般點位)
        const editBtn = window.createUnifiedAuditButton('修改', '#f39c12', () => {
            if (isCustom) {
                if (typeof window.openCustomPointModal === 'function') {
                    // 取得點位有名稱/Key/座標
                    const pointKey = props.auditPointKey || props.name || props.title;
                    const coords = extraData?.geometry?.coordinates || extraData?.feature?.geometry?.coordinates;
                    const lat = coords ? coords[1] : (props.lat || 0);
                    const lng = coords ? coords[0] : (props.lng || 0);

                    // 帶入快取中的完整歷史紀錄（包含舊照片與歷史狀態）
                    const historyRecord = window.auditLayersState?.[currentKmlId]?.[pointKey] || {};

                    window.openCustomPointModal({
                        isEditMode: true,
                        oldPointKey: pointKey,
                        pointKey: pointKey,
                        status: historyRecord.deviceStatus || props.auditStatus || '新增',
                        remark: historyRecord.note || props.auditNote || '',
                        photos: historyRecord.photos || props.photos || [],
                        lat: lat,
                        lng: lng
                    });
                } else {
                    console.error("❌ 找不到 openCustomPointModal 函式");
                }
            } else {
                if (typeof window.openAuditFormModal === 'function') {
                    window.openAuditFormModal(extraData);
                }
            }
        });
        container.appendChild(editBtn);

        // 3. 🗑️ 刪除按鈕 (只有自訂點位才顯示)
        if (isCustom) {
            const delBtn = window.createUnifiedAuditButton('🗑️ 刪除', '#e74c3c', () => {
                const pointKey = props.auditPointKey || props.name || props.title;
                const selectEl = document.getElementById('kmlLayerSelect');
                const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || window.currentActiveKmlName || '預設區域';
                const layerFolderName = rawLayerName.replace(/\.kml$/i, '').trim();

                if (typeof window.deleteCustomPoint === 'function') {
                    window.deleteCustomPoint(currentKmlId, pointKey, layerFolderName);
                }
            });
            container.appendChild(delBtn);
        }

    } else if (mode === 'AUDIT_MAIN') {
        const auditBtn = window.createUnifiedAuditButton('清查點位', '#2ecc71', () => {
            if (typeof window.openAuditFormModal === 'function') {
                window.openAuditFormModal(extraData);
            }
        });
        container.appendChild(auditBtn);

    } else {
        const addBtn = window.createUnifiedAuditButton('➕ 新增點位', '#2ecc71', () => {
            if (typeof window.startAddCustomPoint === 'function') {
                window.startAddCustomPoint(currentKmlId);
            }
        });
        container.appendChild(addBtn);
    }
};

// =========================================================
// 5-6. 清查資料編輯、修改與刪除紀錄邏輯 (含 Storage 照片與 CSV 清理)
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

    // 取得歷史紀錄 (修改模式時帶入)
    const historyRecord = isModifyMode ? (window.auditLayersState?.[kmlId]?.[pointKey] || {}) : {};

    // 💡 判斷是否為「新增點位」
    const isUserCreatedPoint = !!(
        layerProps.isCustom || 
        layerProps.isNew || 
        layerProps.isUserAdded || 
        layerProps.createdByUser || 
        kmlId === 'custom_points' ||
        historyRecord.deviceStatus === '新增' ||
        layerProps.deviceStatus === '新增'
    );

    // 初始化照片陣列
    const currentPhotos = new Array(maxPhotos).fill('');
    if (isModifyMode && Array.isArray(historyRecord.photos)) {
        historyRecord.photos.forEach((url, idx) => {
            if (idx < maxPhotos) currentPhotos[idx] = url || '';
        });
    }

    // 設備狀態設定
    const currentStatus = isUserCreatedPoint ? '新增' : (historyRecord.deviceStatus || '');
    const currentNote = historyRecord.note || '';

    // 💡 選單樣式：新增點位鎖定為 "新增" (灰底 + disabled)
    const layerConfig = window.globalAuditConfigs?.[kmlId] || {};
    let statusOptions = layerConfig.statusOptions || 
                          (localStorage.getItem('audit_status_options') ? JSON.parse(localStorage.getItem('audit_status_options')) : ['正常','損壞','遺失']);

    if (!statusOptions.includes('新增')) {
        statusOptions = ['新增', ...statusOptions];
    }

    let statusSelectHtml = '';
    if (isUserCreatedPoint) {
        statusSelectHtml = `
            <select id="swal-status" class="swal2-input" disabled style="width:100%; margin:6px 0 16px 0; background-color:#e9ecef; color:#495057; cursor:not-allowed;">
                <option value="新增" selected>新增</option>
            </select>`;
    } else {
        const statusOptionsHtml = statusOptions.map(opt => 
            `<option value="${opt}" ${currentStatus === opt ? 'selected' : ''}>${opt}</option>`
        ).join('');
        
        statusSelectHtml = `
            <select id="swal-status" class="swal2-input" style="width:100%; margin:6px 0 16px 0;">
                <option value="" ${!currentStatus ? 'selected' : ''}>--- 請選擇設備狀態 ---</option>
                ${statusOptionsHtml}
            </select>`;
    }

    // 💡 預覽與壓縮處理輔助函式
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

    // 動態生成照片區域 HTML
    let photoHtml = '';
    for (let i = 0; i < maxPhotos; i++) {
        const photoData = currentPhotos[i] || '';
        const isUrl = photoData.startsWith('http');
        
        photoHtml += `
            <div style="position:relative; margin-bottom:18px;">
                <div style="border:2px dashed #ccc; height:85px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:8px; overflow:hidden;">
                    <img id="audit-prev-${i}" src="${photoData}" style="width:100%; height:100%; object-fit:cover; display:${photoData ? 'block' : 'none'}; position:absolute; top:0; left:0; z-index:1;">
                    <span id="audit-icon-${i}" style="font-size:24px; color:#bbb; display:${photoData ? 'none' : 'block'}; z-index:1;">📷</span>
                    <input type="file" id="audit-file-input-${i}" accept="image/*" capture="environment" onchange="window._tempPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;" title="點擊拍攝或更換照片">
                </div>
                <div id="audit-tag-${i}" style="position:absolute; left:50%; transform:translateX(-50%); bottom:-10px; z-index:3; background:#444; color:#fff; font-size:11px; padding:2px 8px; border-radius:10px; display:flex; align-items:center; gap:3px; white-space:nowrap;">
                    ${isUrl ? '<span>🖼️</span> 舊照片' : (photoData ? '<span>🖼️</span> 新選擇' : '<span>📷</span> 拍攝/上傳')}
                </div>
            </div>`;
    }

    const { value: res, isDenied } = await Swal.fire({
        title: `<div style="font-size:18px;">${isModifyMode ? '修改' : '填寫'}清查紀錄：${window.escapeHtml(pointKey)}</div>`,
        html: `<div style="text-align:left;">
            <label style="font-size:14px; font-weight:bold;">設備狀態 <span style="color:red;">*必選</span></label>
            ${statusSelectHtml}

            <label style="font-size:14px; font-weight:bold;">現場照片 (需滿 ${maxPhotos} 張) <span style="color:red;">*必填</span></label>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(95px, 1fr)); gap:10px; margin:8px 0 16px 0;">
                ${photoHtml}
            </div>

            <label style="font-size:14px; font-weight:bold;">備註事項 <span style="color:#888; font-weight:normal;">(選填)</span></label>
            <textarea id="swal-note" class="swal2-textarea" style="width:100%; height:70px; margin:6px 0 0 0; resize:vertical;" placeholder="輸入備註事項...">${window.escapeHtml(currentNote)}</textarea>
        </div>`,
        showCancelButton: true,
        showDenyButton: isUserCreatedPoint,
        denyButtonText: '🗑️ 刪除點位',
        denyButtonColor: '#e74c3c',
        confirmButtonText: isModifyMode ? '覆蓋更新' : '確認並上傳',
        cancelButtonText: '取消',
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

    delete window._tempPreview;

    // 🗑️ 邏輯 A：徹底刪除新增點位 (刪除 Storage 照片 + Firestore + 更新 CSV)
    if (isDenied) {
        const confirmDelete = await Swal.fire({
            title: '確定要刪除此新增點位？',
            text: `點位 [ ${pointKey} ] 的 Storage 照片、清查紀錄與 CSV 報表資料將會被永久移除。`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: '確定刪除',
            cancelButtonText: '取消'
        });

        if (confirmDelete.isConfirmed) {
            Swal.fire({ title: '正在清理 Storage 照片與紀錄...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const appPath = typeof APP_PATH !== 'undefined' ? APP_PATH : 'kmlData';

                // 1. 💡 刪除 Firebase Storage 照片
                if (Array.isArray(historyRecord.photos) && historyRecord.photos.length > 0) {
                    const deletePhotoPromises = historyRecord.photos.map(async (photoUrl) => {
                        if (photoUrl && photoUrl.startsWith('http')) {
                            try {
                                const photoRef = firebase.storage().refFromURL(photoUrl);
                                await photoRef.delete();
                            } catch (err) {
                                console.warn(`Storage 照片刪除失敗或已不存在 (${photoUrl}):`, err);
                            }
                        }
                    });
                    await Promise.all(deletePhotoPromises);
                }

                // 2. 刪除 Firestore 上的清查紀錄
                await firebase.firestore()
                    .collection(appPath)
                    .doc(kmlId)
                    .collection('auditRecords')
                    .doc(pointKey)
                    .delete();

                // 3. 刪除自訂點位本體 (若有存放在獨立集合)
                if (typeof deleteCustomPointFromFirestore === 'function') {
                    await deleteCustomPointFromFirestore(kmlId, pointKey);
                }

                // 4. 清除本地記憶體/快取 (讓 CSV 重新產生時不會讀取到已刪除的點位)
                if (window.auditLayersState?.[kmlId]?.[pointKey]) {
                    delete window.auditLayersState[kmlId][pointKey];
                }

                // 5. 💡 重新產生並覆蓋 CSV 報表 (點位已從 state 移除，CSV 內自然不會存在該點位)
                if (typeof generateLayerCsvReport === 'function') {
                    await generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos);
                }

                // 6. 從地圖上完全移除該 Marker / Layer
                if (activePoint && typeof activePoint.remove === 'function') {
                    activePoint.remove();
                } else if (window.mapNamespace?.map && activePoint) {
                    window.mapNamespace.map.removeLayer(activePoint);
                }

                Swal.fire({ icon: 'success', title: '點位與照片已成功徹底刪除', timer: 1200, showConfirmButton: false });

                if (typeof forceMapRefresh === 'function') forceMapRefresh();
                if (typeof updateBottomBtnState === 'function') setTimeout(updateBottomBtnState, 300);

            } catch (e) {
                console.error("徹底刪除點位失敗:", e);
                Swal.fire('錯誤', e.message || '刪除失敗', 'error');
            }
        }
        return;
    }
    
    // 💾 邏輯 B：確認並上傳 / 覆蓋更新
    if (res) {
        Swal.fire({ title: '正在上傳與更新資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        try {
            const rootPath = typeof STORAGE_ROOT !== 'undefined' ? STORAGE_ROOT : 'audit_photos';
            
            const uploadPromises = res.photos.map(async (photoData, i) => {
                if (photoData && photoData.startsWith('data:image')) {
                    const photoIndexStr = String(i + 1).padStart(2, '0');
                    const customStoragePath = `${rootPath}/${kmlLayerName}/${pointKey}_${photoIndexStr}.jpg`;
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

            Swal.fire({ icon: 'success', title: '更新成功', timer: 1000, showConfirmButton: false });
            
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
