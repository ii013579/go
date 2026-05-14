/**
 * audit-module.js - v2.21
 * 整合：權限分級、路徑修正、CSV總表自動統整、載入穩定性修復
 */
(function() {
    'use strict';

    // --- 全域狀態管理 ---
    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = window.globalAuditConfigs || {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;
    
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    // ---------------------------------------------------------
    // 1. 地圖刷新與樣式攔截邏輯
    // ---------------------------------------------------------

    // 定義於頂層確保所有地方都能呼叫
    function forceMapRefresh() {
        const ns = window.mapNamespace;
        if (typeof window.addGeoJsonLayers === 'function' && ns?.allKmlFeatures) {
            if (ns.currentKmlLayer && ns.map) {
                ns.map.removeLayer(ns.currentKmlLayer);
            }
            window.addGeoJsonLayers(ns.allKmlFeatures);
            console.log("Audit Module: Map style synchronized.");
        }
    }

    // 防止重複攔截導致的效能問題
    if (!window._auditHooked) {
        const originalAddLayers = window.addGeoJsonLayers;
        window.addGeoJsonLayers = function(features) {
            const ns = window.mapNamespace;
            const kmlId = ns?.currentKmlLayerId;
            
            if (kmlId) {
                const config = window.globalAuditConfigs[kmlId];
                const records = window.auditLayersState[kmlId] || {};
                // 判定是否有權限讀取紀錄 (User, Editor, Owner 才會有 records)
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
                        // Guest, Unapproved 或未開啟清查：顯示原始紅點
                        f.properties.fillColor = "#e74c3c"; 
                        f.properties.radius = 8;
                        delete f.properties.auditStatus;
                    }
                });
            }
            if (originalAddLayers) return originalAddLayers.apply(this, arguments);
        };
        window._auditHooked = true;
    }

    // ---------------------------------------------------------
    // 2. CSV 總表生成邏輯
    // ---------------------------------------------------------
    async function updateAreaSummaryCsv(kmlId, kmlLayerName) {
        const records = window.auditLayersState[kmlId];
        if (!records) return;

        const ns = window.mapNamespace;
        const features = ns?.allKmlFeatures || [];
        
        // 構建 CSV 字串 (含 BOM 以防 Excel 中文亂碼)
        let csvContent = "\uFEFF點名,狀態,備註,照片連結清單\n"; 
        
        features.forEach(f => {
            const fId = f.properties.id || f.id;
            const name = f.properties.name || "未命名";
            const rec = records[fId];
            if (rec) {
                const photos = (rec.photos || []).join(" | ");
                const note = (rec.note || "").replace(/"/g, '""'); // 處理 CSV 引號
                csvContent += `"${name}","${rec.status}","${note}","${photos}"\n`;
            }
        });

        try {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const csvPath = `${STORAGE_ROOT}/${kmlLayerName}/_區域清查總表_${kmlLayerName}.csv`;
            await firebase.storage().ref().child(csvPath).put(blob);
            console.log("Summary CSV updated in storage.");
        } catch (e) {
            console.error("CSV Update Error:", e);
        }
    }

    // ---------------------------------------------------------
    // 3. 編輯視窗與上傳
    // ---------------------------------------------------------
    window.openAuditEditor = async function() {
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) return;

        const selectEl = document.getElementById('kmlLayerSelect');
        const rawName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '區域';
        // 修正路徑：移除 .kml 副檔名
        const kmlLayerName = rawName.replace(/\.kml$/i, '').trim();
        
        const pointName = activePoint.properties?.name || '未命名';
        const kmlId = activePoint.properties.kmlId || window.mapNamespace?.currentKmlLayerId;
        const featureId = activePoint.properties.id || activePoint.id;
        const config = window.globalAuditConfigs[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos;

        const currentPhotos = Array.isArray(activePoint.properties.photos) 
            ? [...activePoint.properties.photos] 
            : new Array(maxPhotos).fill('');

        // 閉包處理照片預覽
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
            title: `<span style="font-size:18px;">清樁紀錄：${pointName}</span>`,
            html: `<div style="text-align:left;">
                <label><b>設備狀態 *</b></label>
                <select id="swal-status" class="swal2-input" style="width:100%; margin:5px 0 15px 0;">
                    <option value="正常" ${activePoint.properties.auditStatus==='正常'?'selected':''}>正常</option>
                    <option value="毀損" ${activePoint.properties.auditStatus==='毀損'?'selected':''}>毀損</option>
                    <option value="遺失" ${activePoint.properties.auditStatus==='遺失'?'selected':''}>遺失</option>
                </select>
                <label><b>現場照片 (需${maxPhotos}張)</b></label>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(80px, 1fr)); gap:8px; margin:5px 0 15px 0;">${photoHtml}</div>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%; height:60px;" placeholder="輸入備註...">${activePoint.properties.auditNote || ''}</textarea>
            </div>`,
            showCancelButton: true,
            confirmButtonText: '確認並上傳',
            preConfirm: () => {
                const s = document.getElementById('swal-status').value;
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
                    if (d.startsWith('data:image')) {
                        const path = `${STORAGE_ROOT}/${kmlLayerName}/${pointName}_${String(i+1).padStart(2,'0')}.jpg`;
                        const ref = firebase.storage().ref().child(path);
                        await ref.put(await (await fetch(d)).blob());
                        photoUrls.push(await ref.getDownloadURL());
                    } else if (d) photoUrls.push(d);
                }
                
                const recordData = { status: res.status, note: res.note, photos: photoUrls, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(featureId).set(recordData, { merge: true });

                // 本地快取立即更新並產出 CSV
                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][featureId] = recordData;
                
                await updateAreaSummaryCsv(kmlId, kmlLayerName);
                
                Swal.fire({ icon: 'success', title: '成功', timer: 1000, showConfirmButton: false });
                setTimeout(forceMapRefresh, 100);
            } catch (e) { 
                Swal.fire('上傳失敗', '權限不足或網路錯誤', 'error'); 
            }
        }
    };

    // ---------------------------------------------------------
    // 4. 初始化監聽與 UI
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
        if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
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

    // 底部按鈕顯示邏輯
    function updateBottomBtnState() {
        if (!bottomControl) return;
        const active = window.currentSelectedPoint;
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId];
        if (active && config?.isAuditing) {
            bottomControl._container.style.display = 'block';
            bottomControl._container.innerHTML = `
                <div style="padding-bottom:20px;">
                    <button onclick="window.openAuditEditor()" style="background:#3498db; color:white; border:3px solid #fff; padding:12px 35px; border-radius:50px; font-weight:bold; cursor:pointer; box-shadow:0 4px 10px rgba(0,0,0,0.3);">開始清樁</button>
                </div>`;
        } else {
            bottomControl._container.style.display = 'none';
        }
    }
    window.addEventListener('click', () => setTimeout(updateBottomBtnState, 200));

    // 等待地圖初始化
    const checkReady = setInterval(() => {
        if (window.mapNamespace?.map && typeof L !== 'undefined') {
            clearInterval(checkReady);
            initListener();
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
        }
    }, 500);
})();