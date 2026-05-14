/**
 * audit-module.js - v2.22
 * 基於 v2.18 恢復並修正：
 * 1. 自動修正 Storage 路徑（移除 .kml 副檔名）。
 * 2. 每次上傳後自動產出該區域 CSV 總表並寫入 Storage。
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
    // 1. 樣式與刷新核心邏輯
    // ---------------------------------------------------------

    function forceMapRefresh() {
        const ns = window.mapNamespace;
        if (window.addGeoJsonLayers && ns?.allKmlFeatures) {
            if (ns.currentKmlLayer && ns.map) {
                ns.map.removeLayer(ns.currentKmlLayer);
            }
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
            const hasRecordAccess = Object.keys(records).length > 0;

            features.forEach(f => {
                f.properties.kmlId = kmlId;
                const fId = f.properties.id || f.id;
                
                if (config && config.isAuditing === true && hasRecordAccess) {
                    const record = records[fId];
                    if (record) {
                        f.properties.auditStatus = record.status;
                        f.properties.auditNote = record.note;
                        f.properties.photos = record.photos || [];
                        f.properties.fillColor = "#ff85c0"; 
                        f.properties.radius = 10;
                    } else {
                        f.properties.auditStatus = null;
                        f.properties.fillColor = "#3498db"; 
                        f.properties.radius = 10;
                    }
                    f.properties.color = "#ffffff";
                    f.properties.fillOpacity = 0.9;
                } else {
                    f.properties.fillColor = "#e74c3c"; 
                    f.properties.radius = 8;
                    delete f.properties.auditStatus;
                }
            });
        }
        if (originalAddLayers) return originalAddLayers.apply(this, arguments);
    };

    // ---------------------------------------------------------
    // 2. CSV 總表生成函式
    // ---------------------------------------------------------
    async function updateAreaSummaryCsv(kmlId, folderName) {
        const records = window.auditLayersState[kmlId];
        if (!records) return;

        const ns = window.mapNamespace;
        const features = ns?.allKmlFeatures || [];
        
        // CSV 標頭 (含 BOM 防止 Excel 中文亂碼)
        let csvContent = "\uFEFF點名,狀態,備註,照片連結串接\n"; 
        
        features.forEach(f => {
            const fId = f.properties.id || f.id;
            const name = f.properties.name || "未命名";
            const rec = records[fId];
            if (rec) {
                const note = (rec.note || "").replace(/"/g, '""'); // 處理 CSV 引號轉義
                const photoStr = (rec.photos || []).join(" | ");
                csvContent += `"${name}","${rec.status}","${note}","${photoStr}"\n`;
            }
        });

        try {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const csvPath = `${STORAGE_ROOT}/${folderName}/_區域清查總表_${folderName}.csv`;
            await firebase.storage().ref().child(csvPath).put(blob);
            console.log(`CSV 總表已更新: ${csvPath}`);
        } catch (e) {
            console.error("生成 CSV 總表失敗", e);
        }
    }

    // ---------------------------------------------------------
    // 3. 底部控制按鈕
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
    // 4. 清樁編輯與上傳核心
    // ---------------------------------------------------------
    window.openAuditEditor = async function() {
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) return;

        const selectEl = document.getElementById('kmlLayerSelect');
        const rawName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '區域';
        // 【修正】移除檔名中的 .kml 以作為資料夾名稱
        const kmlLayerName = rawName.replace(/\.kml$/i, '').trim();
        
        const pointName = activePoint.properties?.name || '未命名';
        const kmlId = activePoint.properties.kmlId || window.mapNamespace?.currentKmlLayerId;
        const featureId = activePoint.properties.id || activePoint.id;
        const config = window.globalAuditConfigs[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos;

        const currentPhotos = Array.isArray(activePoint.properties.photos) 
            ? [...activePoint.properties.photos] 
            : new Array(maxPhotos).fill('');

        window._tempPreview = function(input, index) {
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let w = img.width, h = img.height;
                        if (w > h) { if (w > 1024) { h *= 1024/w; w = 1024; } }
                        else { if (h > 1024) { w *= 1024/h; h = 1024; } }
                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        const b64 = canvas.toDataURL('image/jpeg', 0.8);
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
            Swal.fire({ title: '正在上傳資料與更新總表...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
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
                
                const recordData = { 
                    status: res.status, 
                    note: res.note, 
                    photos: photoUrls, 
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
                };

                // 1. 寫入 Firestore
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(featureId).set(recordData, { merge: true });
                
                // 2. 本地快取立即更新以確保 CSV 包含最新資料
                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][featureId] = recordData;

                // 3. 更新該圖層的 CSV 總表
                await updateAreaSummaryCsv(kmlId, kmlLayerName);
                
                Swal.fire({ icon: 'success', title: '上傳成功', timer: 1000, showConfirmButton: false });
                setTimeout(() => { forceMapRefresh(); updateBottomBtnState(); }, 100);
            } catch (e) { 
                Swal.fire('權限不足或上傳失敗', '只有專案成員可以執行此操作。', 'error'); 
            }
        }
    };
    
    // ---------------------------------------------------------
    // 5. 初始化與監聽
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
                if (error.code === 'permission-denied') {
                    window.auditLayersState[kmlId] = {}; 
                    forceMapRefresh(); 
                }
            });
    }

    const initListener = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) { 
            setTimeout(initListener, 500); return; 
        }
        firebase.firestore().collection(APP_PATH).onSnapshot(snapshot => {
            snapshot.forEach(doc => { 
                window.globalAuditConfigs[doc.id] = doc.data(); 
                if (doc.data().isAuditing) startAuditDataListener(doc.id);
            });
            forceMapRefresh();
        });
    };

    const checkReady = setInterval(() => {
        if (window.mapNamespace?.map && typeof L !== 'undefined') {
            clearInterval(checkReady);
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
})();