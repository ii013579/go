/**
 * audit-module.js - v2.18
 * 完整整合版：
 * 1. 權限分級：User/Editor/Owner 可見清查狀態（藍/粉），Guest/Unapproved 僅見紅點。
 * 2. 錯誤修復：修正 forceMapRefresh 作用域問題，解決 Uncaught ReferenceError。
 * 3. UI 修復：解決照片預覽區域顯示 CSS 程式碼的問題。
 * 4. 即時同步：上傳後立即翻轉顏色，並同步至 Firebase 供所有授權使用者查看。
 */
(function() {
    'use strict';

    // --- 全域變數定義 ---
    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;
    
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    // ---------------------------------------------------------
    // 1. 樣式與刷新核心邏輯 (核心定義區)
    // ---------------------------------------------------------

    /**
     * 強制地圖刷新函式
     * 放在頂層確保 startAuditDataListener 與 initListener 都能呼叫到
     */
    function forceMapRefresh() {
        const ns = window.mapNamespace;
        if (window.addGeoJsonLayers && ns?.allKmlFeatures) {
            // 如果地圖上已有 KML 圖層，先移除以強制 Leaflet 重新渲染
            if (ns.currentKmlLayer && ns.map) {
                ns.map.removeLayer(ns.currentKmlLayer);
            }
            // 重新執行渲染邏輯
            window.addGeoJsonLayers(ns.allKmlFeatures);
            console.log("地圖樣式已重繪");
        }
    }

    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId;
        
        if (kmlId) {
            const config = window.globalAuditConfigs[kmlId];
            const records = window.auditLayersState[kmlId] || {};
            
            // 判定是否具備讀取紀錄的權限（若 records 為空代表可能為 Guest 或尚未載入）
            const hasRecordAccess = Object.keys(records).length > 0;

            features.forEach(f => {
                f.properties.kmlId = kmlId;
                const fId = f.properties.id || f.id;
                
                // 只有「圖層開啟清查」且「目前使用者有權限讀取紀錄」時，顯示藍/粉點
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
    // 2. 底部控制按鈕
    // ---------------------------------------------------------
    function updateBottomBtnState() {
        if (!bottomControl) return;
        const active = window.currentSelectedPoint;
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId];

        // 注意：這裡不阻擋 Guest 看到按鈕，由 openAuditEditor 內部的上傳權限與 Rules 判定
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
    // 3. 清樁編輯與上傳核心
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

        // 閉包預覽函式
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
                
                // 本地快取立即更新 (Latency Compensation)
                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][featureId] = { status: res.status, note: res.note, photos: photoUrls };

                // 寫入 Firestore
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(featureId).set({
                    status: res.status, note: res.note, photos: photoUrls, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                
                Swal.fire({ icon: 'success', title: '成功', timer: 1000, showConfirmButton: false });
                
                // 強制翻轉顏色為粉紅
                setTimeout(() => { forceMapRefresh(); updateBottomBtnState(); }, 100);
            } catch (e) { 
                Swal.fire('權限不足或上傳失敗', '只有 Editor 或 Owner 角色可以執行此操作。', 'error'); 
            }
        }
    };
    
    // ---------------------------------------------------------
    // 4. 初始化與監聽
    // ---------------------------------------------------------
    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        
        auditUnsubscribes[kmlId] = firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snapshot => {
                const updates = {};
                snapshot.forEach(doc => updates[doc.id] = doc.data());
                window.auditLayersState[kmlId] = updates;
                forceMapRefresh();
            }, error => {
                // 如果權限被 Rules 拒絕 (Guest/Unapproved)
                if (error.code === 'permission-denied') {
                    window.auditLayersState[kmlId] = {}; 
                    forceMapRefresh(); 
                }
            });
    }

    const initListener = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) { 
            setTimeout(initListener, 500); 
            return; 
        }
        
        firebase.firestore().collection(APP_PATH).onSnapshot(snapshot => {
            snapshot.forEach(doc => { 
                window.globalAuditConfigs[doc.id] = doc.data(); 
                if (doc.data().isAuditing) startAuditDataListener(doc.id);
            });
            forceMapRefresh();
        });
    };

    // 地圖載入後啟動
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