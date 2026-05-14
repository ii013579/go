/**
 * audit-module.js - v2.19
 * 修正重點：
 * 1. 修正路徑：移除儲存資料夾名稱中的 ".kml" 字樣 (參考 image_a1a41e.png)。
 * 2. 資料統整：每次更新後自動生成區域總表 (CSV) 並上傳至 Storage。
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
    // 1. 核心邏輯：強制刷新與樣式攔截
    // ---------------------------------------------------------
    function forceMapRefresh() {
        const ns = window.mapNamespace;
        if (window.addGeoJsonLayers && ns?.allKmlFeatures) {
            if (ns.currentKmlLayer && ns.map) ns.map.removeLayer(ns.currentKmlLayer);
            window.addGeoJsonLayers(ns.allKmlFeatures);
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
                if (config?.isAuditing === true && hasRecordAccess) {
                    const record = records[fId];
                    if (record) {
                        f.properties.auditStatus = record.status;
                        f.properties.auditNote = record.note;
                        f.properties.photos = record.photos || [];
                        f.properties.fillColor = "#ff85c0"; 
                        f.properties.radius = 10;
                    } else {
                        f.properties.fillColor = "#3498db"; 
                        f.properties.radius = 10;
                    }
                    f.properties.color = "#ffffff";
                    f.properties.fillOpacity = 0.9;
                } else {
                    f.properties.fillColor = "#e74c3c"; 
                    f.properties.radius = 8;
                }
            });
        }
        if (originalAddLayers) return originalAddLayers.apply(this, arguments);
    };

    // ---------------------------------------------------------
    // 2. CSV 總表統整函式
    // ---------------------------------------------------------
    async function updateAreaSummaryCsv(kmlId, kmlLayerName) {
        const records = window.auditLayersState[kmlId];
        if (!records) return;

        const ns = window.mapNamespace;
        const features = ns?.allKmlFeatures || [];
        
        // 建立 CSV 內容
        let csvContent = "\uFEFF點名,狀態,備註,照片連結清單\n"; // 加入 BOM 防止中文亂碼
        
        features.forEach(f => {
            const fId = f.properties.id || f.id;
            const name = f.properties.name || "未命名";
            const rec = records[fId];
            
            if (rec) {
                const photos = (rec.photos || []).join(" | ");
                // 處理 CSV 逗號問題，將備註與名稱包裹引號
                csvContent += `"${name}","${rec.status}","${(rec.note || "").replace(/"/g, '""')}","${photos}"\n`;
            }
        });

        // 上傳至 Storage
        try {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const csvPath = `${STORAGE_ROOT}/${kmlLayerName}/_區域清查總表_${kmlLayerName}.csv`;
            await firebase.storage().ref().child(csvPath).put(blob);
            console.log(`總表已更新: ${csvPath}`);
        } catch (e) {
            console.error("總表上傳失敗", e);
        }
    }

    // ---------------------------------------------------------
    // 3. 清樁編輯與上傳
    // ---------------------------------------------------------
    window.openAuditEditor = async function() {
        const activePoint = window.currentSelectedPoint;
        if (!activePoint) return;

        const selectEl = document.getElementById('kmlLayerSelect');
        // 【修正】使用 replace 移除名稱中的 .kml 字樣
        let rawName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '區域';
        const kmlLayerName = rawName.replace(/\.kml$/i, '').trim();
        
        const pointName = activePoint.properties?.name || '未命名';
        const kmlId = activePoint.properties.kmlId || window.mapNamespace?.currentKmlLayerId;
        const featureId = activePoint.properties.id || activePoint.id;
        const config = window.globalAuditConfigs[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos;

        const currentPhotos = Array.isArray(activePoint.properties.photos) 
            ? [...activePoint.properties.photos] 
            : new Array(maxPhotos).fill('');

        // 預覽邏輯 (略，與 v2.18 同)
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
                        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
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

        // UI 產生 (略，與 v2.18 同)
        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const photoData = currentPhotos[i] || '';
            photoHtml += `
                <div style="border:2px dashed #ccc; height:85px; position:relative; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:8px; overflow:hidden;">
                    <input type="file" accept="image/*" capture="environment" onchange="window._tempPreview(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2;">
                    <img id="audit-prev-${i}" src="${photoData}" style="width:100%; height:100%; object-fit:cover; display:${photoData ? 'block' : 'none'}; z-index:1;">
                    <span id="audit-icon-${i}" style="font-size:24px; color:#bbb; display:${photoData ? 'none' : 'block'};">📷</span>
                </div>`;
        }

        const { value: res } = await Swal.fire({
            title: `清樁紀錄：${pointName}`,
            html: `<div style="text-align:left;">
                <select id="swal-status" class="swal2-input" style="width:100%;"><option value="正常">正常</option><option value="毀損">毀損</option><option value="遺失">遺失</option></select>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(80px, 1fr)); gap:8px; margin:10px 0;">${photoHtml}</div>
                <textarea id="swal-note" class="swal2-textarea" placeholder="備註...">${activePoint.properties.auditNote || ''}</textarea>
            </div>`,
            preConfirm: () => {
                const s = document.getElementById('swal-status').value;
                if (currentPhotos.filter(p => p).length < maxPhotos) { Swal.showValidationMessage(`請拍滿 ${maxPhotos} 張`); return false; }
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
                
                // 更新 Firestore
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(featureId).set({
                    status: res.status, note: res.note, photos: photoUrls, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                // 【關鍵】上傳成功後，立即更新總表 CSV
                await updateAreaSummaryCsv(kmlId, kmlLayerName);
                
                Swal.fire({ icon: 'success', title: '成功', timer: 1000, showConfirmButton: false });
                setTimeout(forceMapRefresh, 100);
            } catch (e) { Swal.fire('錯誤', e.message, 'error'); }
        }
    };

    // ---------------------------------------------------------
    // 4. 初始化監聽 (略，參考 v2.18)
    // ---------------------------------------------------------
    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        auditUnsubscribes[kmlId] = firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snapshot => {
                const updates = {};
                snapshot.forEach(doc => updates[doc.id] = doc.data());
                window.auditLayersState[kmlId] = updates;
                forceMapRefresh();
            }, error => { if (error.code === 'permission-denied') forceMapRefresh(); });
    }

    const initListener = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) { setTimeout(initListener, 500); return; }
        firebase.firestore().collection(APP_PATH).onSnapshot(snapshot => {
            snapshot.forEach(doc => { 
                window.globalAuditConfigs[doc.id] = doc.data(); 
                if (doc.data().isAuditing) startAuditDataListener(doc.id);
            });
            forceMapRefresh();
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