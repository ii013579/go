/**
 * audit-module.js - 2026.04.14 最終全功能穩定版
 * * 核心功能：
 * 1. [清單管理]：支援每個圖層獨立「開/關」清查，並自定義 2-10 張照片。
 * 2. [多人同步]：狀態寫入 Firebase，所有使用者下拉選單同步顯示 "(清查中:xx張)"。
 * 3. [顏色攔截]：不更動 map-logic，自動將清查中點位變藍色，已清查變粉紅。
 * 4. [清樁按鈕]：點擊圖徵才出現按鈕，點擊按鈕開啟編輯器後按鈕立即自動消失。
 */
(function() {
    'use strict';

    // --- 內部狀態變數 ---
    window.auditLayersState = window.auditLayersState || {};    // 點位紀錄資料庫
    window.globalAuditConfigs = {};                            // 圖層開關配置
    const auditUnsubscribes = {};
    let bottomControl = null;
    
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    // ---------------------------------------------------------
    // 1. Firebase 核心監聽：全域配置與下拉選單文字同步
    // ---------------------------------------------------------
    const initGlobalConfigListener = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            setTimeout(initGlobalConfigListener, 500);
            return;
        }

        // 監控圖層清單的開關狀態
        firebase.firestore().collection(APP_PATH).onSnapshot(snapshot => {
            snapshot.forEach(doc => {
                window.globalAuditConfigs[doc.id] = doc.data();
            });
            updateKmlSelectUI();
            
            // 如果當前圖層正開啟清查，確保數據監聽已啟動
            const currentId = window.mapNamespace?.currentKmlLayerId;
            if (currentId && window.globalAuditConfigs[currentId]?.isAuditing) {
                if (!auditUnsubscribes[currentId]) startAuditDataListener(currentId);
            }
            
            // 強制地圖更新點位顏色
            refreshMapVisuals();
        });
    };

    function updateKmlSelectUI() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select || select.options.length <= 1) return;

        Array.from(select.options).forEach(opt => {
            if (!opt.value) return;
            const config = window.globalAuditConfigs[opt.value];
            const baseName = opt.getAttribute('data-basename') || opt.textContent.split(' (清查中')[0];
            
            if (!opt.getAttribute('data-basename')) opt.setAttribute('data-basename', baseName);

            if (config?.isAuditing) {
                opt.textContent = `${baseName} (清查中:${config.targetPhotos || 2}張)`;
            } else {
                opt.textContent = baseName;
            }
        });
    }

    // ---------------------------------------------------------
    // 2. 清查管理員：清單式對話框
    // ---------------------------------------------------------
    window.showAuditActionModal = async function() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select || select.options.length <= 1) {
            Swal.fire('請稍候', '圖層清單尚在載入中...', 'info');
            return;
        }

        let listHtml = '<div style="max-height: 400px; overflow-y: auto; text-align: left; border: 1px solid #eee; border-radius: 8px;">';
        Array.from(select.options).forEach(opt => {
            if (!opt.value) return;
            const config = window.globalAuditConfigs[opt.value] || {};
            const isAuditing = config.isAuditing || false;
            const displayName = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
            
            listHtml += `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid #f0f0f0;">
                    <span style="font-weight: bold; flex: 1; font-size: 14px;">${displayName}</span>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        ${isAuditing ? 
                            `<span style="color: #ff85c0; font-size: 11px; background: #fff0f6; padding: 2px 6px; border-radius: 10px;">中:${config.targetPhotos}張</span>
                             <button onclick="window.toggleAuditStatus('${opt.value}', false)" style="background: #666; color: white; border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer;">關</button>` :
                            `<button onclick="window.toggleAuditStatus('${opt.value}', true)" style="background: #3498db; color: white; border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer;">開</button>`
                        }
                    </div>
                </div>`;
        });
        listHtml += '</div>';

        Swal.fire({
            title: '清查圖層管理員',
            html: listHtml,
            showConfirmButton: false,
            showCloseButton: true
        });
    };

    window.toggleAuditStatus = async function(kmlId, status) {
        if (status) {
            const { value: count } = await Swal.fire({
                title: '設定必填照片張數',
                input: 'select',
                inputOptions: { '2':'2張','3':'3張','4':'4張','5':'5張','10':'10張' },
                inputValue: '2'
            });
            if (count) {
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({
                    isAuditing: true,
                    targetPhotos: parseInt(count)
                }, { merge: true });
                startAuditDataListener(kmlId);
            }
        } else {
            await firebase.firestore().collection(APP_PATH).doc(kmlId).set({ isAuditing: false }, { merge: true });
            if (auditUnsubscribes[kmlId]) { auditUnsubscribes[kmlId](); delete auditUnsubscribes[kmlId]; }
        }
        window.showAuditActionModal(); // 刷新清單
    };

    // ---------------------------------------------------------
    // 3. 視覺攔截機制 (變藍/粉紅點的關鍵)
    // ---------------------------------------------------------
    function refreshMapVisuals() {
        if (window.addGeoJsonLayers && window.mapNamespace?.allKmlFeatures) {
            window.addGeoJsonLayers(window.mapNamespace.allKmlFeatures);
        }
    }

    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        if (ns?.currentKmlLayerId) {
            const kmlId = ns.currentKmlLayerId;
            const config = window.globalAuditConfigs[kmlId];
            const records = window.auditLayersState[kmlId] || {};

            features.forEach(f => {
                f.properties.kmlId = kmlId;
                if (config?.isAuditing) {
                    const record = records[f.properties.id || f.id];
                    if (record) {
                        f.properties.auditStatus = record.status;
                        f.properties.photos = record.photos || [];
                        f.properties.fillColor = "#ff85c0"; // 已清：粉紅
                    } else {
                        f.properties.fillColor = "#3498db"; // 未清：藍
                    }
                } else {
                    // 恢復預設 (紅)
                    f.properties.fillColor = "#ff0000";
                    delete f.properties.auditStatus;
                }
            });
        }
        return originalAddLayers ? originalAddLayers.apply(this, arguments) : null;
    };

    // ---------------------------------------------------------
    // 4. 地圖底部「清樁」按鈕控制
    // ---------------------------------------------------------
    function updateBottomBtnState() {
        if (!bottomControl) return;
        const active = window.currentSelectedPoint;
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId];

        // 僅當：圖層開啟清查 且 點選了特定點位
        if (active && config?.isAuditing) {
            bottomControl._container.style.display = 'block';
            bottomControl._container.innerHTML = `
                <div class="audit-bottom-menu-container">
                    <button onclick="window.openAuditEditor()" 
                            style="background:#3498db; color:white; border:3px solid #fff; padding:15px 40px; border-radius:50px; font-weight:bold; font-size:18px; box-shadow:0 4px 15px rgba(0,0,0,0.5); cursor:pointer;">
                        清樁
                    </button>
                </div>`;
        } else {
            bottomControl._container.style.display = 'none';
        }
    }

    // 監聽地圖點擊事件，自動更新按鈕
    window.addEventListener('click', () => { setTimeout(updateBottomBtnState, 150); });

    // ---------------------------------------------------------
    // 5. 清樁編輯器與上傳邏輯
    // ---------------------------------------------------------
    window.openAuditEditor = async function() {
        const point = window.currentSelectedPoint;
        if (!point) return;

        // 點擊清樁後，按鈕立即消失 (需求要求)
        if (bottomControl) bottomControl._container.style.display = 'none';

        const kmlId = point.properties.kmlId || window.mapNamespace?.currentKmlLayerId;
        const featureId = point.properties.id || point.id;
        const config = window.globalAuditConfigs[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos;

        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const photoData = point.properties.photos?.[i] || '';
            photoHtml += `
                <div style="border:2px dashed #ccc;height:85px;position:relative;display:flex;align-items:center;justify-content:center;background:#fafafa;border-radius:8px;overflow:hidden;">
                    <input type="file" accept="image/*" capture="environment" onchange="window.handleAuditPhotoPreview(this, ${i})" style="position:absolute;width:100%;height:100%;opacity:0;z-index:2;cursor:pointer;">
                    <img id="audit-prev-${i}" src="${photoData}" style="width:100%;height:100%;object-fit:cover;display:${photoData?'block':'none'};z-index:1;">
                    <span id="audit-icon-${i}" style="font-size:24px;color:#bbb;display:${photoData?'none':'block'};z-index:1;">📷</span>
                </div>`;
        }

        const { value: res } = await Swal.fire({
            title: `清樁紀錄 (需${maxPhotos}張)`,
            html: `<div style="text-align:left;">
                <label><b>清查狀態</b></label>
                <select id="swal-status" class="swal2-input" style="width:100%;margin:10px 0 15px 0;">
                    <option value="正常" ${point.properties.auditStatus==='正常'?'selected':''}>正常</option>
                    <option value="毀損" ${point.properties.auditStatus==='毀損'?'selected':''}>毀損</option>
                    <option value="遺失" ${point.properties.auditStatus==='遺失'?'selected':''}>遺失</option>
                </select>
                <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(80px, 1fr));gap:8px;margin-bottom:15px;">${photoHtml}</div>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%;height:60px;margin:0;" placeholder="備註內容...">${point.properties.auditNote || ''}</textarea>
            </div>`,
            showCancelButton: true,
            confirmButtonText: '確認上傳',
            preConfirm: () => ({
                status: document.getElementById('swal-status').value,
                note: document.getElementById('swal-note').value,
                photos: point.properties.photos || []
            })
        });

        if (res) {
            Swal.fire({ title: '上傳處理中...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const photoUrls = [];
                for (let i = 0; i < res.photos.length; i++) {
                    const data = res.photos[i];
                    if (data && data.startsWith('data:image')) {
                        const ref = firebase.storage().ref().child(`${STORAGE_ROOT}/${kmlId}/${featureId}_${i}.jpg`);
                        await ref.put(await (await fetch(data)).blob());
                        photoUrls.push(await ref.getDownloadURL());
                    } else if (data) photoUrls.push(data);
                }
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(featureId).set({
                    status: res.status, note: res.note, photos: photoUrls, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                Swal.fire({ icon: 'success', title: '儲存完成', timer: 1000, showConfirmButton: false });
            } catch (e) { Swal.fire('錯誤', e.message, 'error'); }
        }
    };

    // 影像壓縮處理
    window.handleAuditPhotoPreview = function(input, index) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 1024; canvas.height = 768;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, 1024, 768);
                    ctx.drawImage(img, 0, 0, 1024, 768);
                    const base64 = canvas.toDataURL('image/jpeg', 0.8);
                    document.getElementById('audit-prev-' + index).src = base64;
                    document.getElementById('audit-prev-' + index).style.display = 'block';
                    document.getElementById('audit-icon-' + index).style.display = 'none';
                    if (!window.currentSelectedPoint.properties.photos) window.currentSelectedPoint.properties.photos = [];
                    window.currentSelectedPoint.properties.photos[index] = base64;
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(input.files[0]);
        }
    };

    // ---------------------------------------------------------
    // 6. 輔助功能：實時數據監聽器
    // ---------------------------------------------------------
    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        auditUnsubscribes[kmlId] = firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snapshot => {
                const updates = {};
                snapshot.forEach(doc => updates[doc.id] = doc.data());
                window.auditLayersState[kmlId] = updates;
                refreshMapVisuals();
            });
    }

    // 初始化底部容器
    document.addEventListener('DOMContentLoaded', () => {
        if (!window.mapNamespace?.map) return;
        const AuditMenu = L.Control.extend({
            options: { position: 'bottomcenter' },
            onAdd: function() {
                this._container = L.DomUtil.create('div', 'audit-bottom-menu-container');
                this._container.style.display = 'none';
                return this._container;
            }
        });
        bottomControl = new AuditMenu();
        bottomControl.addTo(window.mapNamespace.map);
        initGlobalConfigListener();
    });

    console.log("[Audit] 全功能 2026.04.14 最終版已準備就緒。");
})();