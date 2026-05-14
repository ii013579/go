/**
 * audit-module.js - v2.10
 * 整合功能：
 * 1. 自動攔截圖層渲染，注入藍色(未清查)/粉色(已清查)樣式
 * 2. 監聽地圖選取狀態，動態顯示/隱藏底部「清樁」按鈕
 * 3. 管理選單彈窗同步顯示「照片張數」資訊
 * 4. 整合 Firebase 實時監聽與資料上傳
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
    // 1. 樣式攔截器：在圖層載入地圖前注入顏色屬性
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
                
                if (config && config.isAuditing === true) {
                    const record = records[f.properties.id || f.id];
                    if (record) {
                        // 已完成清查：粉紅色
                        f.properties.auditStatus = record.status;
                        f.properties.photos = record.photos || [];
                        f.properties.fillColor = "#ff85c0"; 
                        f.properties.radius = 10;
                    } else {
                        // 開啟清查但尚未填寫：藍色
                        f.properties.auditStatus = null;
                        f.properties.fillColor = "#3498db"; 
                        f.properties.radius = 10;
                    }
                    f.properties.color = "#ffffff";    // 白色外框
                    f.properties.fillOpacity = 0.9;
                } else {
                    // 未開啟清查模式：恢復預設紅點樣式
                    f.properties.fillColor = "#e74c3c";
                    f.properties.color = "#ffffff";
                    f.properties.radius = 8;
                    delete f.properties.auditStatus;
                }
            });
        }
        if (originalAddLayers) return originalAddLayers.apply(this, arguments);
    };

    // 強制地圖組件依據最新狀態重新渲染
    function forceMapRefresh() {
        if (window.addGeoJsonLayers && window.mapNamespace?.allKmlFeatures) {
            window.addGeoJsonLayers(window.mapNamespace.allKmlFeatures);
        }
    }

    // ---------------------------------------------------------
    // 2. 底部控制按鈕：監測全域 currentSelectedPoint 狀態
    // ---------------------------------------------------------
    function updateBottomBtnState() {
        if (!bottomControl) return;
        const active = window.currentSelectedPoint; // 需配合 map-logic.js 點擊時賦值
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId];

        // 只有在選取了點位，且該圖層正處於清查模式時才顯示
        if (active && config && config.isAuditing === true) {
            bottomControl._container.style.display = 'block';
            bottomControl._container.innerHTML = `
                <div class="audit-bottom-menu-container" style="padding-bottom: 20px; text-align: center;">
                    <button onclick="window.openAuditEditor()" 
                            style="background:#3498db; color:white; border:3px solid #fff; padding:12px 40px; border-radius:50px; font-weight:bold; font-size:18px; box-shadow:0 4px 15px rgba(0,0,0,0.4); cursor:pointer; pointer-events:auto;">
                        開始清樁
                    </button>
                </div>`;
        } else {
            bottomControl._container.style.display = 'none';
        }
    }

    // 監聽點擊事件以延遲更新按鈕狀態
    window.addEventListener('click', () => { setTimeout(updateBottomBtnState, 200); });

    // ---------------------------------------------------------
    // 3. 清查管理對話框：顯示照片張數設定
    // ---------------------------------------------------------
    window.showAuditActionModal = async function() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select || select.options.length <= 1) {
            Swal.fire('載入中', '圖層清單讀取中，請稍候。', 'info'); return;
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
                startAuditDataListener(kmlId);
                setTimeout(window.showAuditActionModal, 500); 
            }
        } else {
            await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: false }, { merge: true });
            setTimeout(window.showAuditActionModal, 500);
        }
    };

    // ---------------------------------------------------------
    // 4. 清樁資料編輯與上傳邏輯
    // ---------------------------------------------------------
    window.openAuditEditor = async function() {
        // 鎖定當前點位，確保在非同步操作中資料來源穩定
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) {
            Swal.fire('錯誤', '請先在地圖上點選點位', 'error');
            return;
        }
    
        const kmlId = activePoint.properties.kmlId || window.mapNamespace?.currentKmlLayerId;
        const featureId = activePoint.properties.id || activePoint.id;
        const config = window.globalAuditConfigs[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos;
    
        // 初始化照片陣列
        if (!activePoint.properties.photos) activePoint.properties.photos = [];
    
        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const photoData = activePoint.properties.photos[i] || '';
            photoHtml += `
                <div style="border:2px dashed #ccc;height:85px;position:relative;display:flex;align-items:center;justify-content:center;background:#fafafa;border-radius:8px;overflow:hidden;">
                    <input type="file" accept="image/*" capture="environment" onchange="window.handleAuditPhotoPreview(this, ${i})" style="position:absolute;width:100%;height:100%;opacity:0;z-index:2;cursor:pointer;">
                    <img id="audit-prev-${i}" src="${photoData}" style="width:100%;height:100%;object-fit:cover;display:${photoData?'block':'none'};z-index:1;">
                    <span id="audit-icon-${i}" style="font-size:24px;color:#bbb;display:${photoData?'none':'block'};z-index:1;">📷</span>
                </div>`;
        }
    
        const { value: res } = await Swal.fire({
            title: `清樁紀錄 (需拍${maxPhotos}張)`,
            html: `<div style="text-align:left;">
                <label><b>設備狀態 <span style="color:red;">*必選</span></b></label>
                <select id="swal-status" class="swal2-input" style="width:100%;margin:10px 0 15px 0;">
                    <option value="" ${!activePoint.properties.auditStatus ? 'selected' : ''}>--- 請選擇 ---</option>
                    <option value="正常" ${activePoint.properties.auditStatus==='正常'?'selected':''}>正常</option>
                    <option value="毀損" ${activePoint.properties.auditStatus==='毀損'?'selected':''}>毀損</option>
                    <option value="遺失" ${activePoint.properties.auditStatus==='遺失'?'selected':''}>遺失</option>
                </select>
                <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(80px, 1fr));gap:8px;margin-bottom:15px;">${photoHtml}</div>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%;height:60px;margin:0;" placeholder="輸入備註事項...">${activePoint.properties.auditNote || ''}</textarea>
            </div>`,
            showCancelButton: true,
            confirmButtonText: '確認上傳',
            preConfirm: () => {
                const statusValue = document.getElementById('swal-status').value;
                const photos = activePoint.properties.photos || [];
    
                // 驗證 1：檢查是否已選擇有效的設備狀態
                if (!statusValue) {
                    Swal.showValidationMessage('請選擇設備狀態 (正常、毀損或遺失)');
                    return false;
                }
    
                // 驗證 2：檢查照片張數是否足夠
                if (photos.filter(p => p).length < maxPhotos) {
                    Swal.showValidationMessage(`請拍滿 ${maxPhotos} 張照片`);
                    return false;
                }
    
                return {
                    status: statusValue,
                    note: document.getElementById('swal-note').value,
                    photos: photos
                };
            }
        });
    
        if (res) {
            Swal.fire({ title: '正在上傳資料...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const photoUrls = [];
                for (let i = 0; i < res.photos.length; i++) {
                    const data = res.photos[i];
                    if (data && data.startsWith('data:image')) {
                        // 上傳新照片到 Firebase Storage
                        const ref = firebase.storage().ref().child(`${STORAGE_ROOT}/${kmlId}/${featureId}_${i}.jpg`);
                        await ref.put(await (await fetch(data)).blob());
                        photoUrls.push(await ref.getDownloadURL());
                    } else if (data) {
                        // 保留既有的照片 URL
                        photoUrls.push(data);
                    }
                }
                
                // 更新 Firestore 中的清查紀錄
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(featureId).set({
                    status: res.status, 
                    note: res.note, 
                    photos: photoUrls, 
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
    
                Swal.fire({ icon: 'success', title: '上傳成功', timer: 1000, showConfirmButton: false });
            } catch (e) { 
                console.error("上傳失敗:", e);
                Swal.fire('錯誤', '上傳失敗：' + e.message, 'error'); 
            }
        }
    };

    // ---------------------------------------------------------
    // 5. 資料初始化監聽
    // ---------------------------------------------------------
    const initGlobalConfigListener = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            setTimeout(initGlobalConfigListener, 500); return;
        }
        // 監聽所有圖層的清查設定 (isAuditing, targetPhotos)
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

    // 啟動腳本
    document.addEventListener('DOMContentLoaded', () => {
        const checkMap = setInterval(() => {
            if (window.mapNamespace?.map) {
                clearInterval(checkMap);
                const AuditMenu = L.Control.extend({
                    options: { position: 'bottomcenter' },
                    onAdd: function() {
                        this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                        this._container.style.display = 'none';
                        return this._container;
                    }
                });
                bottomControl = new AuditMenu();
                bottomControl.addTo(window.mapNamespace.map);
                initGlobalConfigListener();
            }
        }, 500);
    });

})();