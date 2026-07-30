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

            let btnHtml = '';
            if (isAudited) {
                btnHtml = `
                    <button onclick="window.viewAuditDetailOnly('${safePointKey}')" 
                            style="background: #e91e63; color: white; border: 2px solid #ffffff; padding: 10px 22px; border-radius: 50px; font-weight: bold; font-size: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); cursor: pointer;">
                        查看
                    </button>
                    <button onclick="window.openAuditEditor(true)" 
                            style="background: #f39c12; color: white; border: 2px solid #ffffff; padding: 10px 22px; border-radius: 50px; font-weight: bold; font-size: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); cursor: pointer;">
                        修改
                    </button>
                `;
            } else {
                btnHtml = `
                    <button onclick="window.openAuditEditor(false)" 
                            style="background: #2ecc71; color: white; border: 2px solid #ffffff; padding: 12px 35px; border-radius: 50px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); cursor: pointer;">
                        清查點位
                    </button>
                `;
            }

            bottomControl._container.style.display = 'block';
            bottomControl._container.innerHTML = `
                <div style="text-align: center; pointer-events: auto; display: flex; gap: 10px; justify-content: center; background: rgba(0,0,0,0.6); padding: 8px 18px; border-radius: 50px; backdrop-filter: blur(5px);">
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
    // 3. CSV 總表生成
    // ---------------------------------------------------------
    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos) {
        const records = window.auditLayersState[kmlId] || {};
        const ns = window.mapNamespace;
        const features = ns?.allKmlFeatures || [];

        // 檔名解析輔助函式：提取檔名並剔除 .jpg / .jpeg
        const getCleanPhotoName = (url) => {
            if (!url) return "";
            try {
                // 取得最後檔名並解碼 UTF-8
                let fileName = decodeURIComponent(url.split("?")[0].split("/").pop());
                // 去除 .jpg 或 .jpeg 副檔名
                fileName = fileName.replace(/\.jpe?g$/i, "");
                // 雙引號轉義，確保 CSV 格式安全
                return fileName.replace(/"/g, '""');
            } catch (e) {
                return url.replace(/"/g, '""');
            }
        };

        let headerArr = ["點名", "設備狀態"];
        for (let i = 1; i <= maxPhotos; i++) headerArr.push(`照片${i}`);
        headerArr.push("備註");
        
        let csvContent = "\uFEFF" + headerArr.join(",") + "\n";

        features.forEach(f => {
            const pointKey = f.properties?.name || f.properties?.title || f.id || "未知點位";
            const record = records[pointKey]; 

            let rowArr = [];
            rowArr.push(`"${pointKey.replace(/"/g, '""')}"`);

            if (record) {
                rowArr.push(`"${record.deviceStatus || '正常'}"`);
                for (let i = 0; i < maxPhotos; i++) {
                    const url = record.photos && record.photos[i] ? record.photos[i] : "";
                    rowArr.push(`"${getCleanPhotoName(url)}"`);
                }
                rowArr.push(`"${(record.note || "").replace(/"/g, '""')}"`);
            } else {
                rowArr.push('""');
                for (let i = 0; i < maxPhotos; i++) rowArr.push('""');
                rowArr.push('""');
            }
            csvContent += rowArr.join(",") + "\n";
        });

        try {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const csvStoragePath = `${STORAGE_ROOT}/${kmlLayerName}/${kmlLayerName}_清查總表.csv`;
            await firebase.storage().ref().child(csvStoragePath).put(blob);
        } catch (err) {
            console.warn("Firebase Storage 寫入 CSV 權限受限，已略過總表產出:", err.message);
        }
    }

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
                // 1. 讀取先前儲存的選項，若無設定則給予預設值 (正常, 損壞, 變更, 遺失)
                const savedOptions = localStorage.getItem('audit_status_options');
                const defaultStatusStr = savedOptions 
                    ? JSON.parse(savedOptions).join(', ') 
                    : '正常, 損壞, 變更, 遺失';

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
       
    // ---------------------------------------------------------
    // 5. 清查資料編輯與上傳邏輯 (語法修復與 4 格狀態版)
    // ---------------------------------------------------------
    window.openAuditEditor = async function(isModifyMode = false) {
        if (!checkHasAuditPermission()) return;
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

        // 圖片處理快照函式 (上限 1920px, 品質 0.82)
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

        // 拼接照片上傳 UI
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
                    <label style="position:absolute; left:50%; transform:translateX(-50%); bottom:-12px; z-index:3; background:#555; color:#fff; font-size:11px; padding:3px 10px; border-radius:12px; cursor:pointer; display:flex; align-items:center; gap:4px; box-shadow:0 2px 4px rgba(0,0,0,0.2); white-space:nowrap; border:1px solid #777;">
                        <span>🖼️</span> 舊檔
                        <input type="file" accept="image/*" onchange="window._tempPreview(this, ${i})" style="display:none;">
                    </label>
                </div>`;
        }

        // ---------------------------------------------------------
        // 動態讀取設備狀態選項 (優先從圖層設定檔抓取，其次讀取 localStorage，最後才用預設值)
        // ---------------------------------------------------------
        const layerConfig = window.globalAuditConfigs?.[kmlId] || {};
        const statusOptions = layerConfig.statusOptions || 
                              (localStorage.getItem('audit_status_options') ? JSON.parse(localStorage.getItem('audit_status_options')) : ['正常','損壞','變更','遺失']);

        const statusOptionsHtml = statusOptions.map(opt => 
            `<option value="${opt}" ${currentStatus === opt ? 'selected' : ''}>${opt}</option>`
        ).join('');

        // 彈出 SweetAlert2 對話框
        const { value: res } = await Swal.fire({
            title: `<div style="font-size:18px;">${isModifyMode ? '修改' : '填寫'}清查紀錄：${escapeHtml(pointKey)}</div>`,
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
                <textarea id="swal-note" class="swal2-textarea" style="width:100%; height:70px; margin:6px 0 0 0; resize:vertical;" placeholder="輸入備註事項...">${escapeHtml(currentNote)}</textarea>
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

        // 銷毀暫存預覽函式
        delete window._tempPreview;
        
        // 表單確認後的上傳邏輯
        if (res) {
            Swal.fire({ title: '正在處理並上傳資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const uploadPromises = res.photos.map(async (data, i) => {
                    if (data && data.startsWith('data:image')) {
                        const photoIndexStr = String(i + 1).padStart(2, '0');
                        const customStoragePath = `${STORAGE_ROOT}/${kmlLayerName}/${pointKey}_${photoIndexStr}.jpg`;
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

                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][pointKey] = structuredData;

                await firebase.firestore()
                    .collection(APP_PATH)
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
    // 6. 查看詳細紀錄彈窗
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
    // 7.打包 Firebase Storage 照片 (直連原生 CORS 下載)
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
    // 8. 資料動態監聽與安全退場機制
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
    // 9. Leaflet 地圖初始化掛載 (輪詢檢查)
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
                    return this._container;
                }
            });
            bottomControl = new AuditMenu();
            bottomControl.addTo(window.mapNamespace.map);
            initGlobalConfigListener();
        } else if (checkAttempts >= maxAttempts) {
            clearInterval(checkMapInterval);
            console.warn("Leaflet 地圖載入逾時，停止清查選單初始化。");
        }
    }, 500);

})();
