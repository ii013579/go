/**
 * audit-module.js - v2.17
 * 修正重點：
 * 1. 解決照片預覽區域顯示 CSS 原始碼的問題 (image_addec0.png 錯誤修復)
 * 2. 強化 HTML 字串引號處理，防止 UI 崩壞
 * 3. 延續 v2.16 所有的即時變色、人類可讀路徑與權限控管邏輯
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
    // 1. 樣式與刷新邏輯
    // ---------------------------------------------------------
    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId;
        
        if (kmlId) {
            const config = window.globalAuditConfigs[kmlId];
            // 取得該圖層的清查紀錄
            const records = window.auditLayersState[kmlId] || {};
            // 檢查是否成功取得紀錄 (若為 Guest，這裡會因為 Rules 被拒絕而保持空值)
            const hasRecordAccess = Object.keys(records).length > 0;

            features.forEach(f => {
                f.properties.kmlId = kmlId;
                const fId = f.properties.id || f.id;
                
                // 只有「圖層開啟清查」且「目前使用者有權限讀取紀錄」時，才顯示藍/粉點
                if (config && config.isAuditing === true && hasRecordAccess) {
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
                    // Guest、Unapproved 或未開啟清查時：一律顯示原始紅點
                    f.properties.fillColor = "#e74c3c"; 
                    f.properties.radius = 8;
                    delete f.properties.auditStatus;
                }
            });
        }
        if (originalAddLayers) return originalAddLayers.apply(this, arguments);
    };

    // ---------------------------------------------------------
    // 2. 底部按鈕
    // ---------------------------------------------------------
    function updateBottomBtnState() {
        if (!bottomControl) return;
        const active = window.currentSelectedPoint;
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId];

        if (active && config && config.isAuditing === true) {
            bottomControl._container.style.display = 'block';
            bottomControl._container.innerHTML = `
                <div style="padding-bottom: 20px; text-align: center;">
                    <button onclick="window.openAuditEditor()" 
                            style="background:#3498db; color:white; border:3px solid #fff; padding:12px 40px; border-radius:50px; font-weight:bold; font-size:18px; box-shadow:0 4px 15px rgba(0,0,0,0.4); cursor:pointer;">
                        開始清樁
                    </button>
                </div>`;
        } else {
            bottomControl._container.style.display = 'none';
        }
    }
    window.addEventListener('click', () => { setTimeout(updateBottomBtnState, 200); });

    // ---------------------------------------------------------
    // 3. 編輯與上傳 (核心修復區)
    // ---------------------------------------------------------
    window.openAuditEditor = async function() {
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) return;

        const selectEl = document.getElementById('kmlLayerSelect');
        const kmlLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '區域';
        const pointName = activePoint.properties?.name || '未命名';
        const kmlId = activePoint.properties.kmlId || window.mapNamespace?.currentKmlLayerId;
        const featureId = activePoint.properties.id || activePoint.id;
        const config = window.globalAuditConfigs[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos;

        const currentPhotos = Array.isArray(activePoint.properties.photos) 
            ? [...activePoint.properties.photos] 
            : new Array(maxPhotos).fill('');

        // 預覽壓縮函式
        window._tempPreview = function(input, index) {
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let w = img.width, h = img.height;
                        if (w > h) { if (w > 1000) { h *= 1000/w; w = 1000; } }
                        else { if (h > 1000) { w *= 1000/h; h = 1000; } }
                        canvas.width = w; canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, w, h);
                        const b64 = canvas.toDataURL('image/jpeg', 0.75);
                        
                        document.getElementById('audit-prev-'+index).src = b64;
                        document.getElementById('audit-prev-'+index).style.display = 'block';
                        document.getElementById('audit-icon-'+index).style.display = 'none';
                        currentPhotos[index] = b64;
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(input.files[0]);
            }
        };

        // 【修正亮點】使用 Template Literals 確保引號嵌套正確，避免 image_addec0.png 的程式碼外露問題
        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const photoData = currentPhotos[i] || '';
            photoHtml += `
                <div style="border:2px dashed #ccc; height:85px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:8px; overflow:hidden;">
                    <input type="file" accept="image/*" capture="environment" 
                           onchange="window._tempPreview(this, ${i})" 
                           style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;">
                    <img id="audit-prev-${i}" src="${photoData}" style="width:100%; height:100%; object-fit:cover; display:${photoData ? 'block' : 'none'}; z-index:1;">
                    <span id="audit-icon-${i}" style="font-size:24px; color:#bbb; display:${photoData ? 'none' : 'block'}; z-index:1;">📷</span>
                </div>`;
        }

        const { value: res } = await Swal.fire({
            title: `<div style="font-size:18px;">清樁紀錄：${pointName}</div>`,
            html: `<div style="text-align:left;">
                <label style="font-size:14px;"><b>設備狀態 <span style="color:red;">*必選</span></b></label>
                <select id="swal-status" class="swal2-input" style="width:100%; margin:5px 0 15px 0;">
                    <option value="" ${!activePoint.properties.auditStatus ? 'selected' : ''}>--- 請選擇狀態 ---</option>
                    <option value="正常" ${activePoint.properties.auditStatus==='正常'?'selected':''}>正常</option>
                    <option value="毀損" ${activePoint.properties.auditStatus==='毀損'?'selected':''}>毀損</option>
                    <option value="遺失" ${activePoint.properties.auditStatus==='遺失'?'selected':''}>遺失</option>
                </select>
                <label style="font-size:14px;"><b>現場照片 (需拍${maxPhotos}張)</b></label>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(80px, 1fr)); gap:8px; margin:5px 0 15px 0;">${photoHtml}</div>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%; height:60px; margin:0;" placeholder="輸入備註事項...">${activePoint.properties.auditNote || ''}</textarea>
            </div>`,
            showCancelButton: true,
            confirmButtonText: '確認並上傳',
            preConfirm: () => {
                const s = document.getElementById('swal-status').value;
                if (!s) { Swal.showValidationMessage('請選擇狀態'); return false; }
                if (currentPhotos.filter(p => p).length < maxPhotos) {
                    Swal.showValidationMessage(`請拍滿 ${maxPhotos} 張照片`); return false;
                }
                return { status: s, note: document.getElementById('swal-note').value, photos: currentPhotos };
            }
        });

        delete window._tempPreview;

        if (res) {
            Swal.fire({ title: '正在上傳...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const photoUrls = [];
                for (let i = 0; i < res.photos.length; i++) {
                    const d = res.photos[i];
                    if (d && d.startsWith('data:image')) {
                        const path = `${STORAGE_ROOT}/${kmlLayerName}/${pointName}_${String(i+1).padStart(2,'0')}.jpg`;
                        const ref = firebase.storage().ref().child(path);
                        await ref.put(await (await fetch(d)).blob());
                        photoUrls.push(await ref.getDownloadURL());
                    } else if (d) photoUrls.push(d);
                }
                
                // 本地快取立即更新
                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][featureId] = { status: res.status, note: res.note, photos: photoUrls };

                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(featureId).set({
                    status: res.status, note: res.note, photos: photoUrls, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                
                Swal.fire({ icon: 'success', title: '成功', timer: 1000, showConfirmButton: false });
                setTimeout(() => { forceMapRefresh(); updateBottomBtnState(); }, 100);
            } catch (e) { Swal.fire('錯誤', e.message, 'error'); }
        }
    };
    
    // ---------------------------------------------------------
    // 4. 初始化與監聽
    // ---------------------------------------------------------
    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        
        // 監聽清查紀錄集合
        auditUnsubscribes[kmlId] = firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snapshot => {
                const updates = {};
                snapshot.forEach(doc => updates[doc.id] = doc.data());
                window.auditLayersState[kmlId] = updates;
                // 成功取得資料，刷新地圖顯示藍/粉點
                forceMapRefresh();
            }, error => {
                // 如果被 Firebase Rules 拒絕 (例如 Guest/Unapproved)
                if (error.code === 'permission-denied') {
                    console.warn(`權限不足：使用者無法讀取 ${kmlId} 的清查內容，維持紅點顯示。`);
                    window.auditLayersState[kmlId] = {}; // 確保清空狀態
                    forceMapRefresh(); // 刷新地圖以確保顯示紅點
                }
            });
    }

    const initListener = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) { setTimeout(initListener, 500); return; }
        
        // 監聽圖層配置 (KML 是否開啟清查)
        firebase.firestore().collection(APP_PATH).onSnapshot(snapshot => {
            snapshot.forEach(doc => { 
                window.globalAuditConfigs[doc.id] = doc.data(); 
                if (doc.data().isAuditing) {
                    startAuditDataListener(doc.id);
                }
            });
            forceMapRefresh();
        }, error => {
            console.error("無法載入圖層配置:", error);
        });
    };

    document.addEventListener('DOMContentLoaded', () => {
        const check = setInterval(() => {
            if (window.mapNamespace?.map) {
                clearInterval(check);
                const M = L.Control.extend({
                    options: { position: 'bottomcenter' },
                    onAdd: function() {
                        this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                        this._container.style.display = 'none';
                        return this._container;
                    }
                });
                bottomControl = new M();
                bottomControl.addTo(window.mapNamespace.map);
                initListener();
            }
        }, 500);
    });
})();