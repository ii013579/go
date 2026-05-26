/**
 * audit-module.js - 最終同步優化版 (確保欄位完整寫入與 Leaflet 強制重繪變色)
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
    // 1. 樣式攔截器 (修正：雙重綁定機制，直接暴力修改 Leaflet 圖層實體外觀)
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
                const pointName = f.properties.name || f.properties.title || f.properties.id || f.id;
                
                if (config && config.isAuditing === true) {
                    const record = records[pointName]; 
                    
                    if (record && (record.status === "已完成" || record.auditStatus === "已完成")) {
                        // 【已清查點位】：記憶體屬性定義
                        f.properties.auditStatus = "已完成";
                        f.properties.auditNote = record.note;
                        f.properties.photos = record.photos || [];
                        f.properties.isAudited = true;
                        f.properties.fillColor = "#ff85c0"; // 粉紅色
                        f.properties.radius = 10;
                    } else {
                        // 【未清查點位】：保持預設藍色
                        f.properties.auditStatus = null;
                        f.properties.isAudited = false;
                        f.properties.fillColor = "#3498db"; // 藍色
                        f.properties.radius = 10;
                    }
                    f.properties.color = "#ffffff";
                    f.properties.fillOpacity = 0.9;
                } else {
                    f.properties.fillColor = "#e74c3c"; 
                    f.properties.radius = 8;
                    f.properties.isAudited = false;
                    delete f.properties.auditStatus;
                }
            });
        }
        if (originalAddLayers) return originalAddLayers.apply(this, arguments);
    };

    /**
     * 【核心修正】暴力實時變色功能
     * 除了依賴原本的 addGeoJsonLayers，在資料庫更新時，
     * 直接把 Leaflet 目前呈現在地圖上的實體圓點（Layer）撈出來強行塗上粉紅色。
     */
    function forceMapRefresh() {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId;
        if (!ns?.map || !kmlId) return;

        const records = window.auditLayersState[kmlId] || {};

        // 遍歷當前地圖上所有的 Leaflet 圖層實體
        ns.map.eachLayer(function(layer) {
            // 檢查這是不是一個點位圖層，並且有沒有 properties 屬性
            if (layer.feature && layer.feature.properties) {
                const props = layer.feature.properties;
                const pointName = props.name || props.title || props.id;
                
                const record = records[pointName];
                if (record && (record.status === "已完成" || record.auditStatus === "已完成")) {
                    // 同步寫入點位運行記憶體
                    props.isAudited = true;
                    props.auditStatus = "已完成";
                    props.photos = record.photos || [];
                    props.auditNote = record.note;

                    // 1. 如果是 CircleMarker (圓圈點)，直接更換樣式成粉紅色
                    if (typeof layer.setStyle === 'function') {
                        layer.setStyle({
                            fillColor: "#ff85c0", // 粉紅
                            color: "#ffffff",
                            weight: 2,
                            fillOpacity: 0.9,
                            radius: 10
                        });
                    }
                    // 2. 如果是 L.marker (大頭針/Icon點)
                    else if (typeof layer.setIcon === 'function') {
                        const pinkIcon = L.divIcon({
                            className: 'custom-pink-point',
                            html: `<div style="background-color: #ff85c0; width: 14px; height: 14px; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.4);"></div>`,
                            iconSize: [14, 14],
                            iconAnchor: [7, 7]
                        });
                        layer.setIcon(pinkIcon);
                    }
                }
            }
        });

        // 觸發重新繪製
        if (window.addGeoJsonLayers && ns.allKmlFeatures) {
            window.addGeoJsonLayers(ns.allKmlFeatures);
        }
    }

    // ---------------------------------------------------------
    // 2. 底部控制按鈕 (選取點位時，導航按鈕與清查按鈕同時出現)
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
            const pointName = layerProps.name || layerProps.title || "未知點位";
            
            const currentRecords = window.auditLayersState[kmlId] || {};
            const record = currentRecords[pointName];
            const isAudited = record !== undefined && (record.status === "已完成" || record.auditStatus === "已完成");

            let lat = 0, lng = 0;
            if (active.getLatLng) {
                const latlng = active.getLatLng();
                lat = latlng.lat;
                lng = latlng.lng;
            } else if (active.feature?.geometry?.coordinates) {
                lng = active.feature.geometry.coordinates[0];
                lat = active.feature.geometry.coordinates[1];
            }

            let actionBtnHtml = '';
            if (isAudited) {
                actionBtnHtml = `
                    <button onclick="window.viewAuditDetailOnly('${pointName}')" 
                            style="background: #e91e63; color: white; border: 2px solid #ffffff; padding: 12px 25px; border-radius: 50px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); cursor: pointer;">
                        查看紀錄 (粉紅)
                    </button>`;
            } else {
                actionBtnHtml = `
                    <button onclick="window.openAuditEditor()" 
                            style="background: #2ecc71; color: white; border: 2px solid #ffffff; padding: 12px 25px; border-radius: 50px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); cursor: pointer;">
                        開始清樁
                    </button>`;
            }

            bottomControl._container.style.display = 'block';
            bottomControl._container.innerHTML = `
                <div style="text-align: center; pointer-events: auto; display: flex; gap: 12px; justify-content: center; background: rgba(0,0,0,0.6); padding: 10px 20px; border-radius: 50px; backdrop-filter: blur(5px);">
                    <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank"
                       style="background: #3498db; color: white; border: 2px solid #ffffff; padding: 12px 25px; border-radius: 50px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); text-decoration: none; display: inline-block;">
                        🗺️ 導航
                    </a>
                    ${actionBtnHtml}
                </div>`;
        } else {
            bottomControl._container.style.display = 'none';
        }
    }
    
    window.addEventListener('click', () => { setTimeout(updateBottomBtnState, 200); });

    // ---------------------------------------------------------
    // 3. 專屬 CSV 總表動態生成產線
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
            const pointName = f.properties?.name || f.properties?.title || "未命名點位";
            const record = records[pointName]; 

            let rowArr = [];
            rowArr.push(`"${pointName.replace(/"/g, '""')}"`);

            if (record) {
                rowArr.push(`"${record.deviceStatus || '正常'}"`);
                for (let i = 0; i < maxPhotos; i++) {
                    const url = record.photos && record.photos[i] ? record.photos[i] : "";
                    rowArr.push(`"${url}"`);
                }
                const safeNote = (record.note || "").replace(/"/g, '""');
                rowArr.push(`"${safeNote}"`);
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
            console.error("產生區域 CSV 總表失敗:", err);
        }
    }

    // ---------------------------------------------------------
    // 4. 清查狀態圖層管理
    // ---------------------------------------------------------
    window.showAuditActionModal = async function() {
        if (!checkHasAuditPermission()) return;
        const select = document.getElementById('kmlLayerSelect');
        if (!select || select.options.length <= 1) return;

        let listHtml = '<div style="max-height: 350px; overflow-y: auto; text-align: left;">';
        Array.from(select.options).forEach(opt => {
            if (!opt.value) return;
            const config = window.globalAuditConfigs[opt.value] || {};
            const isAuditing = config.isAuditing || false;
            const targetPhotos = config.targetPhotos || 2;
            const baseName = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
            
            listHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid #eee;">
                    <div>
                        <div style="font-weight:bold; font-size:14px;">${baseName}</div>
                        ${isAuditing?`<div style="color: #e67e22; font-size:12px;">清查中：需照片 ${targetPhotos} 張</div>`:`<div style="color: #999; font-size: 12px;">未開啟清查</div>`}
                    </div>
                    <button onclick="window.toggleAuditStatus('${opt.value}', ${!isAuditing})" style="background:${isAuditing?'#666':'#3498db'}; color:white; border:none; padding:6px 15px; border-radius:4px; cursor:pointer;">
                        ${isAuditing ? '關閉' : '開啟'}
                    </button>
                </div>`;
        });
        listHtml += '</div>';
        Swal.fire({ title: '圖層清查管理', html: listHtml, showConfirmButton: false, showCloseButton: true });
    };

    window.toggleAuditStatus = async function(kmlId, status) {
        if (!checkHasAuditPermission()) return;
        if (status) {
            const { value: count } = await Swal.fire({
                title: '設定必填照片張數', input: 'select', inputOptions: { '2':'2張','3':'3張','5':'5張' }, inputValue: '2'
            });
            if (count) {
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: true, targetPhotos: parseInt(count) }, { merge: true });
                setTimeout(window.showAuditActionModal, 500); 
            }
        } else {
            await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: false }, { merge: true });
            setTimeout(window.showAuditActionModal, 500);
        }
    };

    // ---------------------------------------------------------
    // 5. 清樁資料編輯與上傳邏輯 (修正：寫入詳盡欄位以利抓取)
    // ---------------------------------------------------------
    window.openAuditEditor = async function() {
        if (!checkHasAuditPermission()) return;
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) return;

        const layerProps = activePoint.feature?.properties || activePoint.properties || {};
        const pointName = layerProps.name || layerProps.title || '未命名點位'; 
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos;

        const selectEl = document.getElementById('kmlLayerSelect');
        const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '預設區域';
        const kmlLayerName = rawLayerName.replace(/\.kml$/i, '').trim(); 

        const currentPhotos = Array.isArray(layerProps.photos) ? [...layerProps.photos] : new Array(maxPhotos).fill('');

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
            title: `<div style="font-size:18px;">清樁紀錄：${pointName}</div>`,
            html: `<div style="text-align:left;">
                <label style="font-size:14px;"><b>設備狀態 <span style="color:red;">*必選</span></b></label>
                <select id="swal-status" class="swal2-input" style="width:100%;margin:5px 0 15px 0;">
                    <option value="" ${!layerProps.auditStatus ? 'selected' : ''}>--- 請選擇狀態 ---</option>
                    <option value="正常" ${layerProps.auditStatus==='正常'?'selected':''}>正常</option>
                    <option value="毀損" ${layerProps.auditStatus==='毀損'?'selected':''}>毀損</option>
                    <option value="遺失" ${layerProps.auditStatus==='遺失'?'selected':''}>遺失</option>
                </select>
                <label style="font-size:14px;"><b>現場照片 (需拍${maxPhotos}張)</b></label>
                <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(80px, 1fr));gap:8px;margin:5px 0 15px 0;">${photoHtml}</div>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%;height:60px;margin:0;" placeholder="輸入備註事項...">${layerProps.auditNote || ''}</textarea>
            </div>`,
            showCancelButton: true,
            confirmButtonText: '確認並上傳',
            preConfirm: () => {
                const statusValue = document.getElementById('swal-status').value;
                if (!statusValue) { Swal.showValidationMessage('請選擇設備狀態'); return false; }
                if (currentPhotos.filter(p => p).length < maxPhotos) { Swal.showValidationMessage(`請拍滿 ${maxPhotos} 張照片`); return false; }
                return { status: statusValue, note: document.getElementById('swal-note').value, photos: currentPhotos };
            }
        });

        delete window._tempPreview;

        if (res) {
            Swal.fire({ title: '正在上傳並更新總表...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const photoUrls = [];
                for (let i = 0; i < res.photos.length; i++) {
                    const data = res.photos[i];
                    if (data && data.startsWith('data:image')) {
                        const photoIndexStr = String(i + 1).padStart(2, '0');
                        const customStoragePath = `${STORAGE_ROOT}/${kmlLayerName}/${pointName}_${photoIndexStr}.jpg`;
                        const ref = firebase.storage().ref().child(customStoragePath);
                        await ref.put(await (await fetch(data)).blob());
                        photoUrls.push(await ref.getDownloadURL());
                    } else if (data) {
                        photoUrls.push(data); 
                    }
                }
                
                // 【核心修正】寫入本地快照與 Firebase 文件完整欄位
                const structuredData = {
                    pointName: pointName,       // 補齊點位名稱
                    status: "已完成",           // 核心清查進度狀態
                    auditStatus: "已完成",      // 備用防護狀態欄位
                    deviceStatus: res.status,   // 設備真實狀態(正常/毀損)
                    note: res.note, 
                    photos: photoUrls, 
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][pointName] = structuredData;

                await firebase.firestore()
                    .collection(APP_PATH)
                    .doc(kmlId)
                    .collection('auditRecords')
                    .doc(pointName) 
                    .set(structuredData, { merge: true });
                
                await generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos);

                Swal.fire({ icon: 'success', title: '上傳與總表更新成功', timer: 1000, showConfirmButton: false });
                
                // 執行強力暴力刷色，杜絕 Leaflet 緩存問題
                forceMapRefresh();
                setTimeout(updateBottomBtnState, 300);
            } catch (e) { 
                Swal.fire('錯誤', e.message, 'error'); 
            }
        }
    };

    // ---------------------------------------------------------
    // 6. 查看已完成的詳細清查紀錄彈窗 (純瀏覽)
    // ---------------------------------------------------------
    window.viewAuditDetailOnly = function(pointName) {
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const record = window.auditLayersState[kmlId]?.[pointName];
        if (!record) return;

        let imagesHtml = '';
        if (Array.isArray(record.photos)) {
            record.photos.forEach(url => {
                if (url) imagesHtml += `<img src="${url}" style="width:45%; margin:2%; max-height:120px; object-fit:cover; border-radius:6px;">`;
            });
        }

        Swal.fire({
            title: `清查紀錄：${pointName}`,
            html: `<div style="text-align: left; font-size:14px;">
                <p><b>設備狀況：</b><span style="color:#ff85c0; font-weight:bold;">🟢 ${record.deviceStatus || '正常'}</span></p>
                <p><b>現場備註：</b><br>${record.note || '無備註'}</p>
                <p><b>現場照片：</b></p>
                <div style="display:flex; flex-wrap:wrap;">${imagesHtml || '無照片'}</div>
            </div>`,
            confirmButtonText: '關閉'
        });
    };
    
    // ---------------------------------------------------------
    // 7. 資料監聽與動態即時初始化 (Real-time Sync)
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
                // 一收到 Firebase 通知，立即進行暴力刷色
                forceMapRefresh(); 
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