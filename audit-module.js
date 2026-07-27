/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (高效能與強健度增強版)
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
    // 0. 權限防護檢查機制
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

    // 安全字元轉義 (防止 XSS 與 UI 破壞)
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
                
                // 優先解析唯一識別碼
                const pointKey = f.properties.name || f.properties.title || f.properties.id || f.id || "未知點位";
                f.properties.auditPointKey = pointKey; 

                // 判斷是否呈現清查狀態配色
                if (config && config.isAuditing === true && canSeeAuditColors()) {
                    const record = records[pointKey];
                    if (record) {
                        f.properties.auditStatus = record.deviceStatus || "正常";
                        f.properties.auditNote = record.note;
                        f.properties.photos = record.photos || [];
                        f.properties.isAudited = true;
                        f.properties.fillColor = "#ff85c0"; // 已清查：粉紅色
                        f.properties.radius = 10;
                    } else {
                        f.properties.isAudited = false;
                        f.properties.auditStatus = null;
                        f.properties.fillColor = "#3498db"; // 未清查：藍色
                        f.properties.radius = 10;
                    }
                    f.properties.color = "#ffffff";
                    f.properties.fillOpacity = 0.9;
                } else {
                    f.properties.fillColor = "#e74c3c"; // 預設/無權限：紅色
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
                        🔍 查看
                    </button>
                    <button onclick="window.openAuditEditor(true)" 
                            style="background: #f39c12; color: white; border: 2px solid #ffffff; padding: 10px 22px; border-radius: 50px; font-weight: bold; font-size: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); cursor: pointer;">
                        ✏️ 修改
                    </button>
                `;
            } else {
                btnHtml = `
                    <button onclick="window.openAuditEditor(false)" 
                            style="background: #2ecc71; color: white; border: 2px solid #ffffff; padding: 12px 35px; border-radius: 50px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); cursor: pointer;">
                        📋 清查點位
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

    // 防抖事件監聽，避免點擊時過度觸發
    window.addEventListener('click', () => { 
        clearTimeout(clickDebounceTimer);
        clickDebounceTimer = setTimeout(updateBottomBtnState, 150); 
    });

    // ---------------------------------------------------------
    // 3. 專屬 CSV 總表生成
    // ---------------------------------------------------------
    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos) {
        const records = window.auditLayersState[kmlId] || {};
        const ns = window.mapNamespace;
        const features = ns?.allKmlFeatures || [];

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
                    rowArr.push(`"${url}"`);
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
    // 4. 清查管理對話框
    // ---------------------------------------------------------
    window.showAuditActionModal = async function() {
        if (!checkHasAuditPermission()) {
            Swal.fire('權限不足', '您的帳號角色不允許管理清查狀態！', 'warning');
            return;
        }
        const select = document.getElementById('kmlLayerSelect');
        if (!select || select.options.length <= 1) return;

        let listHtml = '<div style="max-height: 350px; overflow-y: auto; text-align: left;">';
        Array.from(select.options).forEach(opt => {
            if (!opt.value) return;
            const config = window.globalAuditConfigs[opt.value] || {};
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
                    <button onclick="window.toggleAuditStatus('${safeValue}', ${!isAuditing})" style="background:${isAuditing ? '#666' : '#3498db'}; color:white; border:none; padding:6px 15px; border-radius:4px; cursor:pointer;">
                        ${isAuditing ? '關閉' : '開啟'}
                    </button>
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
                const { value: count } = await Swal.fire({
                    title: '設定必填照片張數', 
                    input: 'select', 
                    inputOptions: { '2':'2張','3':'3張','5':'5張' }, 
                    inputValue: '2',
                    showCancelButton: true
                });
                
                if (count) {
                    Swal.fire({ title: '正在開啟清查...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                    
                    await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ 
                        isAuditing: true, 
                        targetPhotos: parseInt(count, 10) 
                    }, { merge: true });
                    
                    Swal.fire({ icon: 'success', title: '已開啟清查模式', timer: 1000, showConfirmButton: false });
                } else {
                    window.showAuditActionModal();
                }
            } else {
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
                text: `請檢查網路連線或確認帳號權限。\n(錯誤原因: ${error.message})`,
                confirmButtonText: '返回管理視窗'
            }).then(() => {
                window.showAuditActionModal();
            });
        }
    };
    
    // ---------------------------------------------------------
    // 5. 清查資料編輯與併發上傳邏輯 (效能優化版)
    // ---------------------------------------------------------
    window.openAuditEditor = async function(isModifyMode = false) {
        if (!checkHasAuditPermission()) return;
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) return;

        const layerProps = activePoint.feature?.properties || activePoint.properties || {};
        const pointKey = layerProps.name || layerProps.title || layerProps.id || "未知點位"; 
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos;

        const selectEl = document.getElementById('kmlLayerSelect');
        const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '預設區域';
        const kmlLayerName = rawLayerName.replace(/\.kml$/i, '').trim(); 

        const historyRecord = isModifyMode ? (window.auditLayersState[kmlId]?.[pointKey] || {}) : {};
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
                        const max_size = 1000;
                        if (width > height) { if (width > max_size) { height *= max_size / width; width = max_size; } } 
                        else { if (height > max_size) { width *= max_size / height; height = max_size; } }
                        canvas.width = width; canvas.height = height;
                        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                        const base64 = canvas.toDataURL('image/jpeg', 0.75);
                        
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
                <div style="border:2px dashed #ccc;height:85px;position:relative;display:flex;align-items:center;justify-content:center;background:#fafafa;border-radius:8px;overflow:hidden;">
                    <input type="file" accept="image/*" capture="environment" onchange="window._tempPreview(this, ${i})" style="position:absolute;width:100%;height:100%;opacity:0;z-index:2;cursor:pointer;">
                    <img id="audit-prev-${i}" src="${photoData}" style="width:100%;height:100%;object-fit:cover;display:${photoData?'block':'none'};z-index:1;">
                    <span id="audit-icon-${i}" style="font-size:24px;color:#bbb;display:${photoData?'none':'block'};z-index:1;">📷</span>
                </div>`;
        }

        const { value: res } = await Swal.fire({
            title: `<div style="font-size:18px;">${isModifyMode ? '修改' : '填寫'}清查紀錄：${escapeHtml(pointKey)}</div>`,
            html: `<div style="text-align:left;">
                <label style="font-size:14px;"><b>設備狀態 <span style="color:red;">*必選</span></b></label>
                <select id="swal-status" class="swal2-input" style="width:100%;margin:5px 0 15px 0;">
                    <option value="" ${!currentStatus ? 'selected' : ''}>--- 請選擇狀態 ---</option>
                    <option value="正常" ${currentStatus==='正常'?'selected':''}>正常</option>
                    <option value="毀損" ${currentStatus==='毀損'?'selected':''}>毀損</option>
                    <option value="遺失" ${currentStatus==='遺失'?'selected':''}>遺失</option>
                </select>
                <label style="font-size:14px;"><b>現場照片 (需拍${maxPhotos}張)</b></label>
                <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(80px, 1fr));gap:8px;margin:5px 0 15px 0;">${photoHtml}</div>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%;height:60px;margin:0;" placeholder="輸入備註事項...">${escapeHtml(currentNote)}</textarea>
            </div>`,
            showCancelButton: true,
            confirmButtonText: isModifyMode ? '覆蓋更新' : '確認並上傳',
            preConfirm: () => {
                const statusValue = document.getElementById('swal-status').value;
                if (!statusValue) { Swal.showValidationMessage('請選擇設備狀態'); return false; }
                if (currentPhotos.filter(Boolean).length < maxPhotos) { Swal.showValidationMessage(`請拍滿 ${maxPhotos} 張照片`); return false; }
                return { status: statusValue, note: document.getElementById('swal-note').value, photos: currentPhotos };
            }
        });

        delete window._tempPreview;

        if (res) {
            Swal.fire({ title: '正在處理並上傳資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                // 【併發優化】使用 Promise.all 同步上傳圖片
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
                
                await generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos);

                Swal.fire({ icon: 'success', title: '儲存成功', timer: 1000, showConfirmButton: false });
                
                forceMapRefresh();
                setTimeout(updateBottomBtnState, 300);
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
    // 7. 資料動態監聽與安全退場機制
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

    // 提供頁面銷毀時解除所有 Firestore 監聽的輔助函式
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

    // 8. Leaflet 地圖初始化掛載 (限定最大輪詢次數)
    let checkAttempts = 0;
    const maxAttempts = 30; // 最多重試 15 秒
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