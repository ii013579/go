/**
 * audit-module.js - v2.23
 * 修正項目：
 * 1. 解決「清查模組尚未準備就緒」錯誤：優化按鈕綁定與函式作用域。
 * 2. 路徑動態化：儲存路徑由「區域」改為當前 KML 的圖層名稱（自動移除 .kml）。
 * 3. 穩定性：確保 CSV 總表與照片皆存入正確的圖層資料夾。
 */
(function() {
    'use strict';

    // --- 全域變數與狀態 ---
    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = window.globalAuditConfigs || {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;
    
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    // ---------------------------------------------------------
    // 1. 地圖刷新與樣式邏輯
    // ---------------------------------------------------------
    function forceMapRefresh() {
        const ns = window.mapNamespace;
        if (typeof window.addGeoJsonLayers === 'function' && ns?.allKmlFeatures) {
            if (ns.currentKmlLayer && ns.map) {
                ns.map.removeLayer(ns.currentKmlLayer);
            }
            window.addGeoJsonLayers(ns.allKmlFeatures);
        }
    }

    // 攔截渲染邏輯，處理權限分級顏色
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
                
                if (config?.isAuditing === true && hasRecordAccess) {
                    const record = records[fId];
                    if (record) {
                        f.properties.auditStatus = record.status;
                        f.properties.auditNote = record.note;
                        f.properties.photos = record.photos || [];
                        f.properties.fillColor = "#ff85c0"; // 已清查：粉紅
                        f.properties.radius = 10;
                    } else {
                        f.properties.fillColor = "#3498db"; // 未清查：藍色
                        f.properties.radius = 10;
                    }
                    f.properties.color = "#ffffff";
                    f.properties.fillOpacity = 0.9;
                } else {
                    f.properties.fillColor = "#e74c3c"; // 預設：紅點
                    f.properties.radius = 8;
                }
            });
        }
        if (originalAddLayers) return originalAddLayers.apply(this, arguments);
    };

    // ---------------------------------------------------------
    // 2. CSV 總表生成 (依圖層名稱存放)
    // ---------------------------------------------------------
    async function updateAreaSummaryCsv(kmlId, folderName) {
        const records = window.auditLayersState[kmlId];
        if (!records) return;

        const ns = window.mapNamespace;
        const features = ns?.allKmlFeatures || [];
        
        let csvContent = "\uFEFF點名,狀態,備註,照片連結串接\n"; 
        features.forEach(f => {
            const fId = f.properties.id || f.id;
            const name = f.properties.name || "未命名";
            const rec = records[fId];
            if (rec) {
                const note = (rec.note || "").replace(/"/g, '""');
                const photoStr = (rec.photos || []).join(" | ");
                csvContent += `"${name}","${rec.status}","${note}","${photoStr}"\n`;
            }
        });

        try {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const csvPath = `${STORAGE_ROOT}/${folderName}/_區域清查總表_${folderName}.csv`;
            await firebase.storage().ref().child(csvPath).put(blob);
        } catch (e) {
            console.error("CSV Update Error:", e);
        }
    }

    // ---------------------------------------------------------
    // 3. 清樁編輯器 (修正按鈕與路徑)
    // ---------------------------------------------------------
    window.openAuditEditor = async function() {
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) {
            Swal.fire('錯誤', '請先在地圖上點選一個點位', 'warning');
            return;
        }

        // --- 動態獲取圖層名稱作為資料夾 ---
        const selectEl = document.getElementById('kmlLayerSelect');
        const rawName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '未分類區域';
        const kmlLayerName = rawName.replace(/\.kml$/i, '').trim();
        
        const pointName = activePoint.properties?.name || '未命名';
        const kmlId = activePoint.properties.kmlId || window.mapNamespace?.currentKmlLayerId;
        const featureId = activePoint.properties.id || activePoint.id;
        const config = window.globalAuditConfigs[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos;

        const currentPhotos = Array.isArray(activePoint.properties.photos) 
            ? [...activePoint.properties.photos] 
            : new Array(maxPhotos).fill('');

        // 預覽功能
        window._tempPreview = function(input, index) {
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let w = img.width, h = img.height;
                        if (w > 1024 || h > 1024) {
                            if (w > h) { h *= 1024/w; w = 1024; }
                            else { w *= 1024/h; h = 1024; }
                        }
                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        const b64 = canvas.toDataURL('image/jpeg', 0.8);
                        document.getElementById(`audit-prev-${index}`).src = b64;
                        document.getElementById(`audit-prev-${index}`).style.display = 'block';
                        document.getElementById(`audit-icon-${index}`).style.display = 'none';
                        currentPhotos[index] = b64;
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(input.files[0]);
            }
        };

        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const p = currentPhotos[i] || '';
            photoHtml += `
                <div style="border:2px dashed #ccc; height:85px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:8px; overflow:hidden;">
                    <input type="file" accept="image/*" capture="environment" onchange="window._tempPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;">
                    <img id="audit-prev-${i}" src="${p}" style="width:100%; height:100%; object-fit:cover; display:${p ? 'block' : 'none'}; z-index:1;">
                    <span id="audit-icon-${i}" style="font-size:24px; color:#bbb; display:${p ? 'none' : 'block'};">📷</span>
                </div>`;
        }

        const { value: res } = await Swal.fire({
            title: `清樁紀錄：${pointName}`,
            html: `<div style="text-align:left;">
                <label><b>設備狀態 *</b></label>
                <select id="swal-status" class="swal2-input" style="width:100%; margin:5px 0 15px 0;">
                    <option value="正常" ${activePoint.properties.auditStatus==='正常'?'selected':''}>正常</option>
                    <option value="毀損" ${activePoint.properties.auditStatus==='毀損'?'selected':''}>毀損</option>
                    <option value="遺失" ${activePoint.properties.auditStatus==='遺失'?'selected':''}>遺失</option>
                </select>
                <label><b>照片 (需拍滿 ${maxPhotos} 張)</b></label>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(80px, 1fr)); gap:8px; margin:5px 0 15px 0;">${photoHtml}</div>
                <textarea id="swal-note" class="swal2-textarea" placeholder="備註...">${activePoint.properties.auditNote || ''}</textarea>
            </div>`,
            showCancelButton: true,
            confirmButtonText: '上傳紀錄',
            preConfirm: () => {
                const s = document.getElementById('swal-status').value;
                if (currentPhotos.filter(p => p).length < maxPhotos) {
                    Swal.showValidationMessage(`請上傳至少 ${maxPhotos} 張照片`); return false;
                }
                return { status: s, note: document.getElementById('swal-note').value, photos: currentPhotos };
            }
        });

        if (res) {
            Swal.fire({ title: '正在處理...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const photoUrls = [];
                for (let i = 0; i < res.photos.length; i++) {
                    const d = res.photos[i];
                    if (d.startsWith('data:image')) {
                        const path = `${STORAGE_ROOT}/${kmlLayerName}/${pointName}_${i+1}.jpg`;
                        const ref = firebase.storage().ref().child(path);
                        await ref.put(await (await fetch(d)).blob());
                        photoUrls.push(await ref.getDownloadURL());
                    } else if (d) photoUrls.push(d);
                }
                
                const record = { status: res.status, note: res.note, photos: photoUrls, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(featureId).set(record, { merge: true });

                // 更新本地快取與 CSV
                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][featureId] = record;
                await updateAreaSummaryCsv(kmlId, kmlLayerName);
                
                Swal.fire({ icon: 'success', title: '完成', timer: 1000, showConfirmButton: false });
                setTimeout(forceMapRefresh, 100);
            } catch (e) { 
                Swal.fire('失敗', '請確認權限或網路連接', 'error'); 
            }
        }
    };

    // ---------------------------------------------------------
    // 4. 初始化監聽與按鈕
    // ---------------------------------------------------------
    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        auditUnsubscribes[kmlId] = firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snap => {
                const updates = {};
                snap.forEach(doc => updates[doc.id] = doc.data());
                window.auditLayersState[kmlId] = updates;
                forceMapRefresh();
            }, e => { if (e.code === 'permission-denied') window.auditLayersState[kmlId] = {}; });
    }

    function updateBottomBtnState() {
        if (!bottomControl) return;
        const active = window.currentSelectedPoint;
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId];
        
        if (active && config?.isAuditing) {
            bottomControl._container.style.display = 'block';
            bottomControl._container.innerHTML = `
                <div style="padding-bottom:20px;">
                    <button onclick="window.openAuditEditor()" style="background:#3498db; color:white; border:none; padding:12px 35px; border-radius:50px; font-weight:bold; cursor:pointer; box-shadow:0 4px 10px rgba(0,0,0,0.3);">開始清樁</button>
                </div>`;
        } else {
            bottomControl._container.style.display = 'none';
        }
    }

    // 啟動監聽 Firebase Config
    const initAudit = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) return setTimeout(initAudit, 500);
        firebase.firestore().collection(APP_PATH).onSnapshot(snap => {
            snap.forEach(doc => {
                window.globalAuditConfigs[doc.id] = doc.data();
                if (doc.data().isAuditing) startAuditDataListener(doc.id);
            });
            forceMapRefresh();
        });
    };

    // 地圖準備就緒後加入控制項
    const checkMap = setInterval(() => {
        if (window.mapNamespace?.map && typeof L !== 'undefined') {
            clearInterval(checkMap);
            const Control = L.Control.extend({
                options: { position: 'bottomcenter' },
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'audit-ctrl');
                    this._container.style.display = 'none';
                    return this._container;
                }
            });
            bottomControl = new Control();
            bottomControl.addTo(window.mapNamespace.map);
            window.addEventListener('click', () => setTimeout(updateBottomBtnState, 200));
            initAudit();
        }
    }, 500);

})();