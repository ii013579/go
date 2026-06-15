/**
 * audit-module.js - v2.17 最終完美整合版
 * 整合功能：
 * 1. 【手機顯示優化】強制使用 position: fixed，確保「開始清樁」按鈕在手機端絕不被擠出螢幕外。
 * 2. 【預覽樣式修正】修復相機預覽框的內聯 CSS 斷行問題，使相機圖示與虛線框正常顯示。
 * 3. 【乾淨資料夾路徑】自動去除圖層名稱的 .kml 後綴，建立人類可讀的乾淨儲存路徑。
 * 4. 【自適應 CSV 總表】上傳時自動在相同圖層資料夾下產生 (點名,設備狀態,照片1,照片2,...,備註) 檔案。
 * 5. 【狀態即時刷新】上傳完成後，地圖點位顏色（藍變粉）與底端按鈕狀態立即同步刷新。
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
    // 1. 樣式攔截器 (負責渲染 藍、粉、紅 三色點位)
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
                const fId = f.properties.id || f.id;
                
                if (config && config.isAuditing === true) {
                    const record = records[fId];
                    if (record) {
                        // 已清查：粉紅色
                        f.properties.auditStatus = record.status;
                        f.properties.auditNote = record.note;
                        f.properties.photos = record.photos || [];
                        f.properties.fillColor = "#ff85c0"; 
                        f.properties.radius = 10;
                    } else {
                        // 未清查：藍色
                        f.properties.auditStatus = null;
                        f.properties.fillColor = "#3498db"; 
                        f.properties.radius = 10;
                    }
                    f.properties.color = "#ffffff";
                    f.properties.fillOpacity = 0.9;
                } else {
                    // 未開啟清查模式：預設紅色
                    f.properties.fillColor = "#e74c3c"; 
                    f.properties.radius = 8;
                    delete f.properties.auditStatus;
                }
            });
        }
        if (originalAddLayers) return originalAddLayers.apply(this, arguments);
    };

    // 強制重新繪製 Leaflet 地圖圖層
    function forceMapRefresh() {
        if (window.addGeoJsonLayers && window.mapNamespace?.allKmlFeatures) {
            window.addGeoJsonLayers(window.mapNamespace.allKmlFeatures);
        }
    }

    // ---------------------------------------------------------
    // 2. 底部控制按鈕 (解決手機端按鈕被推到螢幕外的問題)
    // ---------------------------------------------------------
    function updateBottomBtnState() {
        if (!bottomControl) return;
        const active = window.currentSelectedPoint;
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId];

        if (active && config && config.isAuditing === true) {
            bottomControl._container.style.display = 'block';
            bottomControl._container.innerHTML = `
                <div style="text-align: center; pointer-events: auto;">
                    <button onclick="window.openAuditEditor()" 
                            style="background: #3498db; color: white; border: 3px solid #ffffff; padding: 12px 45px; border-radius: 50px; font-weight: bold; font-size: 18px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); cursor: pointer;">
                        開始清樁
                    </button>
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

        // 標頭格式：點名,設備狀態,照片1,照片2,...,備註 (帶上 UTF-8 BOM 防止 Excel 亂碼)
        let headerArr = ["點名", "設備狀態"];
        for (let i = 1; i <= maxPhotos; i++) {
            headerArr.push(`照片${i}`);
        }
        headerArr.push("備註");
        
        let csvContent = "\uFEFF" + headerArr.join(",") + "\n";

        // 巡覽該圖層所有點位，確保未清查的也會在表單內留空，方便比對
        features.forEach(f => {
            const fId = f.properties.id || f.id;
            const pointName = f.properties?.name || "未命名點位";
            const record = records[fId];

            let rowArr = [];
            rowArr.push(`"${pointName.replace(/"/g, '""')}"`);

            if (record) {
                rowArr.push(`"${record.status || '正常'}"`);
                // 填入各張照片的下載連結
                for (let i = 0; i < maxPhotos; i++) {
                    const url = record.photos && record.photos[i] ? record.photos[i] : "";
                    rowArr.push(`"${url}"`);
                }
                const safeNote = (record.note || "").replace(/"/g, '""');
                rowArr.push(`"${safeNote}"`);
            } else {
                // 未清查點位則填空
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
            console.log(`[CSV 產生成功] 路徑: ${csvStoragePath}`);
        } catch (err) {
            console.error("產生區域 CSV 總表失敗:", err);
        }
    }

    // ---------------------------------------------------------
    // 4. 清查管理對話框 (圖層管理切換)
    // ---------------------------------------------------------
    window.showAuditActionModal = async function() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select || select.options.length <= 1) {
            Swal.fire('載入中', '圖層清單讀取中...', 'info'); return;
        }

        let listHtml = '<div style="max-height: 350px; overflow-y: auto; text-align: left;">';
        Array.from(select.options).forEach(opt => {
            if (!opt.value) return;
            const config = window.globalAuditConfigs[opt.value] || {};
            const isAuditing = config.isAuditing || false;
            const targetPhotos = config.targetPhotos || 2;
            const baseName = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
            
            const statusInfo = isAuditing 
                ? `<div style="color: #e67e22; font-size: 12px;">清查中：需拍照 ${targetPhotos} 張</div>`
                : `<div style="color: #999; font-size: 12px;">未開啟清查</div>`;

            listHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid #eee;">
                    <div>
                        <div style="font-weight:bold; font-size:14px;">${baseName}</div>
                        ${statusInfo}
                    </div>
                    <button onclick="window.toggleAuditStatus('${opt.value}', ${!isAuditing})" 
                            style="background:${isAuditing?'#666':'#3498db'}; color:white; border:none; padding:6px 15px; border-radius:4px; cursor:pointer; font-weight:bold;">
                        ${isAuditing ? '關閉' : '開啟'}
                    </button>
                </div>`;
        });
        listHtml += '</div>';
        Swal.fire({ title: '圖層清查管理', html: listHtml, showConfirmButton: false, showCloseButton: true });
    };

    window.toggleAuditStatus = async function(kmlId, status) {
        if (status) {
            const { value: count } = await Swal.fire({
                title: '設定必填照片張數',
                input: 'select',
                inputOptions: { '2':'2張','3':'3張','5':'5張','10':'10張' },
                inputValue: '2'
            });
            if (count) {
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({
                    isAuditing: true, targetPhotos: parseInt(count)
                }, { merge: true });
                setTimeout(window.showAuditActionModal, 500); 
            }
        } else {
            await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: false }, { merge: true });
            setTimeout(window.showAuditActionModal, 500);
        }
    };

    // ---------------------------------------------------------
    // 5. 清樁資料編輯與上傳邏輯
    // ---------------------------------------------------------
    window.openAuditEditor = async function() {
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) {
            Swal.fire('錯誤', '請先在地圖上選取一個點位', 'error');
            return;
        }

        // 取得乾淨的圖層名稱（去除結尾的 .kml 確保資料夾路徑整潔）
        const selectEl = document.getElementById('kmlLayerSelect');
        const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '預設區域';
        const kmlLayerName = rawLayerName.replace(/\.kml$/i, '').trim(); 
        
        const pointName = activePoint.properties?.name || '未命名點位';
        const kmlId = activePoint.properties.kmlId || window.mapNamespace?.currentKmlLayerId;
        const featureId = activePoint.properties.id || activePoint.id;
        const config = window.globalAuditConfigs[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos;

        // 深拷貝現有照片陣列
        const currentPhotos = Array.isArray(activePoint.properties.photos) 
            ? [...activePoint.properties.photos] 
            : new Array(maxPhotos).fill('');

        // 安全閉包暫存預覽與圖片壓縮函式
        window._tempPreview = function(input, index) {
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let width = img.width;
                        let height = img.height;
                        const max_size = 1000; 
                        if (width > height) {
                            if (width > max_size) { height *= max_size / width; width = max_size; }
                        } else {
                            if (height > max_size) { width *= max_size / height; height = max_size; }
                        }
                        canvas.width = width; canvas.height = height;
                        
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);
                        const base64 = canvas.toDataURL('image/jpeg', 0.75);
                        
                        const prevImg = document.getElementById('audit-prev-' + index);
                        const prevIcon = document.getElementById('audit-icon-' + index);
                        if (prevImg) { prevImg.src = base64; prevImg.style.display = 'block'; }
                        if (prevIcon) { prevIcon.style.display = 'none'; }

                        currentPhotos[index] = base64;
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(input.files[0]);
            }
        };

        // 建立相片上傳格子 (已修復內聯 CSS 斷行問題)
        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const photoData = currentPhotos[i] || '';
            photoHtml += `
                <div style="border:2px dashed #ccc;height:85px;position:relative;display:flex;align-items:center;justify-content:center;background:#fafafa;border-radius:8px;overflow:hidden;">
                    <input type="file" accept="image/*" capture="environment" 
                           onchange="window._tempPreview(this, ${i})" 
                           style="position:absolute;width:100%;height:100%;opacity:0;z-index:2;cursor:pointer;">
                    <img id="audit-prev-${i}" src="${photoData}" style="width:100%;height:100%;object-fit:cover;display:${photoData?'block':'none'};z-index:1;">
                    <span id="audit-icon-${i}" style="font-size:24px;color:#bbb;display:${photoData?'none':'block'};z-index:1;">📷</span>
                </div>`;
        }

        const { value: res } = await Swal.fire({
            title: `<div style="font-size:18px;">清樁紀錄：${pointName}</div>`,
            html: `<div style="text-align:left;">
                <label style="font-size:14px;"><b>設備狀態 <span style="color:red;">*必選</span></b></label>
                <select id="swal-status" class="swal2-input" style="width:100%;margin:5px 0 15px 0;">
                    <option value="" ${!activePoint.properties.auditStatus ? 'selected' : ''}>--- 請選擇狀態 ---</option>
                    <option value="正常" ${activePoint.properties.auditStatus==='正常'?'selected':''}>正常</option>
                    <option value="毀損" ${activePoint.properties.auditStatus==='毀損'?'selected':''}>毀損</option>
                    <option value="遺失" ${activePoint.properties.auditStatus==='遺失'?'selected':''}>遺失</option>
                </select>
                <label style="font-size:14px;"><b>現場照片 (需拍${maxPhotos}張)</b></label>
                <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(80px, 1fr));gap:8px;margin:5px 0 15px 0;">${photoHtml}</div>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%;height:60px;margin:0;" placeholder="輸入備註事項...">${activePoint.properties.auditNote || ''}</textarea>
            </div>`,
            showCancelButton: true,
            confirmButtonText: '確認並上傳',
            preConfirm: () => {
                const statusValue = document.getElementById('swal-status').value;
                if (!statusValue) {
                    Swal.showValidationMessage('請選擇設備狀態');
                    return false;
                }
                if (currentPhotos.filter(p => p).length < maxPhotos) {
                    Swal.showValidationMessage(`請拍滿 ${maxPhotos} 張照片`);
                    return false;
                }
                return { status: statusValue, note: document.getElementById('swal-note').value, photos: currentPhotos };
            }
        });

        // 關閉對話框後釋放記憶體
        delete window._tempPreview;

        // 執行上傳程序與更新 CSV
        if (res) {
            Swal.fire({ title: '正在上傳並更新總表...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const photoUrls = [];
                for (let i = 0; i < res.photos.length; i++) {
                    const data = res.photos[i];
                    if (data && data.startsWith('data:image')) {
                        const photoIndexStr = String(i + 1).padStart(2, '0');
                        // 結構化檔名與人類可讀儲存路徑： [STORAGE_ROOT]/[圖層名稱]/[點名_序號.jpg]
                        const customStoragePath = `${STORAGE_ROOT}/${kmlLayerName}/${pointName}_${photoIndexStr}.jpg`;
                        
                        const ref = firebase.storage().ref().child(customStoragePath);
                        await ref.put(await (await fetch(data)).blob());
                        photoUrls.push(await ref.getDownloadURL());
                    } else if (data) {
                        photoUrls.push(data); // 保留原有照片的網址
                    }
                }
                
                // 更新本地快取
                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][featureId] = {
                    status: res.status,
                    note: res.note,
                    photos: photoUrls
                };

                // 寫入 Firestore 紀錄
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(featureId).set({
                    status: res.status, 
                    note: res.note, 
                    photos: photoUrls, 
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                
                // 動態生成或更新該圖層獨立的 CSV 資料總表
                await generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos);

                Swal.fire({ icon: 'success', title: '上傳與總表更新成功', timer: 1000, showConfirmButton: false });
                
                // 刷新地圖與按鈕狀態（藍點變粉紅點）
                forceMapRefresh();
                updateBottomBtnState();
            } catch (e) { 
                console.error(e);
                Swal.fire('錯誤', e.message, 'error'); 
            }
        }
    };
    
    // ---------------------------------------------------------
    // 6. 資料監聽與初始化
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
                snapshot.forEach(doc => updates[doc.id] = doc.data());
                window.auditLayersState[kmlId] = updates;
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

    // 異步計時載入控制項，並加上 CSS 強制浮空定位，避免被手機流排版壓出螢幕外
    const checkMapInterval = setInterval(() => {
        if (window.mapNamespace?.map && typeof L !== 'undefined') {
            clearInterval(checkMapInterval);
            
            const AuditMenu = L.Control.extend({
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                    this._container.style.display = 'none';
                    
                    // 【關鍵修正】強制浮空於螢幕最下方，完全無視 Leaflet 預設容器排版
                    this._container.style.position = 'fixed';
                    this._container.style.bottom = '35px';
                    this._container.style.left = '50%';
                    this._container.style.transform = 'translateX(-50%)';
                    this._container.style.zIndex = '5000'; // 置於地圖最上層
                    this._container.style.pointerEvents = 'none'; // 滑鼠/點擊事件穿透，不干擾地圖拖動
                    
                    return this._container;
                }
            });
            bottomControl = new AuditMenu();
            bottomControl.addTo(window.mapNamespace.map);
            initGlobalConfigListener();
        }
    }, 500);

})();