/**
 * audit-module.js - 清查與修改覆蓋整合優化版
 */
(function() {
    'use strict';

    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;
    
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
        if (role === 'guest' || role === 'unapproved') {
            return false;
        }
        return true;
    }

    // ---------------------------------------------------------
    // 1. 樣式攔截器與強力重繪機制 (解決不變色、避免 undefined 錯誤)
    // ---------------------------------------------------------
    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId;
        
        if (kmlId) {
            const config = window.globalAuditConfigs[kmlId];
            const records = window.auditLayersState[kmlId] || {};

            features.forEach(f => {
                f.properties.kmlId = kmlId;
                
                // 【核心修正】若 KML 沒有提供 id，強制以 name (點名) 作為唯一的 PointKey，徹底解決 undefined 錯誤
                const pointKey = f.properties.name || f.properties.title || f.properties.id || f.id || "未知點位";
                f.properties.auditPointKey = pointKey; 

                if (config && config.isAuditing === true) {
                    const record = records[pointKey];
                    if (record) {
                        // 【已清查點位】：記憶體屬性定義
                        f.properties.auditStatus = record.deviceStatus || "正常";
                        f.properties.auditNote = record.note;
                        f.properties.photos = record.photos || [];
                        f.properties.isAudited = true;
                        f.properties.fillColor = "#ff85c0"; // 粉紅色
                        f.properties.radius = 10;
                    } else {
                        // 【未清查點位】：保持預設藍色
                        f.properties.isAudited = false;
                        f.properties.auditStatus = null;
                        f.properties.fillColor = "#3498db"; // 藍色
                        f.properties.radius = 10;
                    }
                    f.properties.color = "#ffffff";
                    f.properties.fillOpacity = 0.9;
                } else {
                    // 未開啟清查模式：預設原始紅色
                    f.properties.fillColor = "#e74c3c"; 
                    f.properties.radius = 8;
                    f.properties.isAudited = false;
                    delete f.properties.auditStatus;
                }
            });
        }
        if (originalAddLayers) return originalAddLayers.apply(this, arguments);
    };

    // 巡檢地圖上的 Leaflet 實體圖層進行即時同步刷色
    function forceMapRefresh() {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId;
        if (!ns?.map || !kmlId) return;

        const records = window.auditLayersState[kmlId] || {};

        ns.map.eachLayer(function(layer) {
            if (layer.feature && layer.feature.properties) {
                const props = layer.feature.properties;
                const pointKey = props.name || props.title || props.id;
                
                const record = records[pointKey];
                if (record) {
                    props.isAudited = true;
                    props.auditStatus = record.deviceStatus || "正常";
                    props.photos = record.photos || [];
                    props.auditNote = record.note;

                    if (typeof layer.setStyle === 'function') {
                        layer.setStyle({
                            fillColor: "#ff85c0", // 強制渲染粉紅
                            color: "#ffffff",
                            weight: 2,
                            fillOpacity: 0.9,
                            radius: 10
                        });
                    }
                } else {
                    if (window.globalAuditConfigs[kmlId]?.isAuditing && typeof layer.setStyle === 'function') {
                        layer.setStyle({
                            fillColor: "#3498db", // 還原藍色
                            color: "#ffffff",
                            weight: 2,
                            fillOpacity: 0.9,
                            radius: 10
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
    // 2. 底部控制按鈕面板 (取消導航、區分藍點與粉紅點切換)
    // ---------------------------------------------------------
    function updateBottomBtnState() {
        if (!bottomControl) return;

        if (!checkHasAuditPermission()) {
            bottomControl._container.style.display = 'none';
            return;
        }

        const active = window.currentSelectedPoint;
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId];

        if (active && config && config.isAuditing === true) {
            const layerProps = active.feature?.properties || active.properties || {};
            const pointKey = layerProps.name || layerProps.title || layerProps.id || "未知點位";
            
            const currentRecords = window.auditLayersState[kmlId] || {};
            const isAudited = currentRecords[pointKey] !== undefined;

            let btnHtml = '';
            if (isAudited) {
                // 【粉紅點狀態】：僅顯示「查看」與「修改」
                btnHtml = `
                    <button onclick="window.viewAuditDetailOnly('${pointKey}')" 
                            style="background: #e91e63; color: white; border: 2px solid #ffffff; padding: 10px 22px; border-radius: 50px; font-weight: bold; font-size: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); cursor: pointer;">
                        🔍 查看
                    </button>
                    <button onclick="window.openAuditEditor(true)" 
                            style="background: #f39c12; color: white; border: 2px solid #ffffff; padding: 10px 22px; border-radius: 50px; font-weight: bold; font-size: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); cursor: pointer;">
                        ✏️ 修改
                    </button>
                `;
            } else {
                // 【藍點狀態】：僅顯示「清查點位」
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
    window.addEventListener('click', () => { setTimeout(updateBottomBtnState, 200); });

    // ---------------------------------------------------------
    // 3. 專屬 CSV 總表生成 (加入異常安全防護，避免權限干擾阻斷)
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
    // 4. 清查管理對話框 (修正引號與異步卡死優化版)
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
            
            // 【修正重點】將 '${opt.value}' 的單引號在字串中確實包好，避免變數未定義錯誤
            listHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid #eee;">
                    <div>
                        <div style="font-weight:bold; font-size:14px;">${baseName}</div>
                        ${isAuditing ? `<div style="color: #e67e22; font-size:12px;">清查中：需照片 ${targetPhotos} 張</div>` : `<div style="color: #999; font-size: 12px;">未開啟清查</div>`}
                    </div>
                    <button onclick="window.toggleAuditStatus('${opt.value}', ${!isAuditing})" style="background:${isAuditing ? '#666' : '#3498db'}; color:white; border:none; padding:6px 15px; border-radius:4px; cursor:pointer;">
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
            if (status) {
                // 先行關閉前一個管理彈窗，避免 Swal DOM 衝突卡死
                Swal.close(); 
                
                const { value: count } = await Swal.fire({
                    title: '設定必填照片張數', 
                    input: 'select', 
                    inputOptions: { '2':'2張','3':'3張','5':'5張' }, 
                    inputValue: '2',
                    showCancelButton: true
                });
                
                if (count) {
                    // 顯示動態處理遮罩
                    Swal.fire({ title: '正在開啟清查...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                    
                    await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ 
                        isAuditing: true, 
                        targetPhotos: parseInt(count) 
                    }, { merge: true });
                    
                    // 稍微延時重開管理面板，確保資料已同步
                    setTimeout(window.showAuditActionModal, 300); 
                } else {
                    // 使用者按取消，則直接退回原本的管理視窗
                    window.showAuditActionModal();
                }
            } else {
                // 關閉清查模式
                Swal.fire({ title: '正在關閉清查...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ 
                    isAuditing: false 
                }, { merge: true });
                
                setTimeout(window.showAuditActionModal, 300);
            }
        } catch (error) {
            console.error("切換清查狀態時發生錯誤:", error);
            Swal.fire('操作失敗', `更新資料庫時出錯: ${error.message}`, 'error');
        }
    };

    // ---------------------------------------------------------
    // 5. 清查資料編輯與上傳邏輯 (支援歷史紀錄覆蓋修改)
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

        // 如果是修改模式，從快照讀取舊資料帶入表單；否則留空
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
                        
                        document.getElementById('audit-prev-' + index).src = base64;
                        document.getElementById('audit-prev-' + index).style.display = 'block';
                        document.getElementById('audit-icon-' + index).style.display = 'none';
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
            title: `<div style="font-size:18px;">${isModifyMode ? '修改' : '填寫'}清查紀錄：${pointKey}</div>`,
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
                <textarea id="swal-note" class="swal2-textarea" style="width:100%;height:60px;margin:0;" placeholder="輸入備註事項...">${currentNote}</textarea>
            </div>`,
            showCancelButton: true,
            confirmButtonText: isModifyMode ? '覆蓋更新' : '確認並上傳',
            preConfirm: () => {
                const statusValue = document.getElementById('swal-status').value;
                if (!statusValue) { Swal.showValidationMessage('請選擇設備狀態'); return false; }
                if (currentPhotos.filter(p => p).length < maxPhotos) { Swal.showValidationMessage(`請拍滿 ${maxPhotos} 張照片`); return false; }
                return { status: statusValue, note: document.getElementById('swal-note').value, photos: currentPhotos };
            }
        });

        delete window._tempPreview;

        if (res) {
            Swal.fire({ title: '正在處理並上傳資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const photoUrls = [];
                for (let i = 0; i < res.photos.length; i++) {
                    const data = res.photos[i];
                    // 如果是重新拍照的 base64 檔案才上傳至 Storage
                    if (data && data.startsWith('data:image')) {
                        const photoIndexStr = String(i + 1).padStart(2, '0');
                        const customStoragePath = `${STORAGE_ROOT}/${kmlLayerName}/${pointKey}_${photoIndexStr}.jpg`;
                        const ref = firebase.storage().ref().child(customStoragePath);
                        await ref.put(await (await fetch(data)).blob());
                        photoUrls.push(await ref.getDownloadURL());
                    } else if (data) {
                        // 否則直接保留原本歷史的 https 圖片網址
                        photoUrls.push(data); 
                    }
                }
                
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

                // 【精準覆蓋】直接指定 doc(pointKey)，無論建立或修改，皆直接覆寫該節點
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
                Swal.fire('錯誤', e.message, 'error'); 
            }
        }
    };

    // ---------------------------------------------------------
    // 6. 查看詳細紀錄彈窗 (純瀏覽)
    // ---------------------------------------------------------
    window.viewAuditDetailOnly = function(pointKey) {
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const record = window.auditLayersState[kmlId]?.[pointKey];
        if (!record) return;

        let imagesHtml = '';
        if (Array.isArray(record.photos)) {
            record.photos.forEach(url => {
                if (url) imagesHtml += `<img src="${url}" style="width:45%; margin:2%; max-height:120px; object-fit:cover; border-radius:6px; border:1px solid #ccc;">`;
            });
        }

        Swal.fire({
            title: `清查紀錄：${pointKey}`,
            html: `<div style="text-align: left; font-size:14px;">
                <p><b>設備狀況：</b><span style="color:#e91e63; font-weight:bold;">🟢 ${record.deviceStatus || '正常'}</span></p>
                <p><b>現場備註：</b><br>${record.note || '無備註'}</p>
                <p><b>現場照片：</b></p>
                <div style="display:flex; flex-wrap:wrap;">${imagesHtml || '無照片'}</div>
            </div>`,
            confirmButtonText: '關閉'
        });
    };
    
    // ---------------------------------------------------------
    // 7. 資料動態監聽 (Real-time Sync)
    // ---------------------------------------------------------
    const initGlobalConfigListener = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            setTimeout(initGlobalConfigListener, 500); return;
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

    const checkMapInterval = setInterval(() => {
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
        }
    }, 500);

})();