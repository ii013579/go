/**
 * audit-module.js - 2026.04.14 獨立模組化版本
 * 功能：
 * 1. 完全獨立的圖層選擇對話框 (Swal2)
 * 2. 影像壓縮處理 (1024x768, 4:3 比例)
 * 3. Firebase Firestore 實時監聽 (Sync 顏色狀態)
 * 4. Storage 分層儲存 (路徑：/storage/{KML_ID}/{Point_ID}.jpg)
 */
(function() {
    'use strict';

    // --- 內部狀態與配置 ---
    window.auditLayersState = window.auditLayersState || {};
    const auditUnsubscribes = {};
    let bottomControl = null;
    
    // 請確認此路徑與您的 Firebase 配置一致
    const STORAGE_ROOT = 'kmldata-d22fb/storage';
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';

    // ---------------------------------------------------------
    // 1. 核心入口：顯示圖層選取對話框
    // ---------------------------------------------------------
    window.showAuditActionModal = async function() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select) {
            console.error("[Audit] 找不到 kmlLayerSelect 元素");
            return;
        }

        // 擷取目前主選單中可用的 KML 選項
        const options = Array.from(select.options)
            .filter(opt => opt.value !== "")
            .map(opt => `<option value="${opt.value}">${opt.textContent}</option>`)
            .join('');

        if (!options) {
            Swal.fire('提示', '目前沒有可供清查的 KML 圖層。', 'info');
            return;
        }

        // 彈出選單讓使用者選擇圖層
        const { value: selectedId } = await Swal.fire({
            title: '啟動清查模式',
            html: `
                <div style="text-align: left;">
                    <p style="margin-bottom: 8px;">請選擇要清查的圖層：</p>
                    <select id="swal-audit-picker" class="swal2-input" style="width:100%; margin: 0 auto; display: block;">
                        ${options}
                    </select>
                    <p style="color: #666; font-size: 13px; margin-top: 15px;">啟動後點擊地圖上的標記點即可進行清查紀錄。</p>
                </div>`,
            showCancelButton: true,
            confirmButtonText: '啟動清查',
            cancelButtonText: '取消',
            preConfirm: () => document.getElementById('swal-audit-picker').value
        });

        if (selectedId) {
            // 自動連動主介面切換圖層
            if (select.value !== selectedId) {
                select.value = selectedId;
                const event = new Event('change');
                select.dispatchEvent(event);
            }

            // 啟動實時監聽
            startAuditListener(selectedId);
            
            // 更新主介面按鈕樣式
            const btn = document.getElementById('auditKmlBtn');
            if (btn) {
                btn.textContent = '清查模式執行中';
                btn.style.background = '#ff85c0'; // 變更為粉紅色代表啟用中
                btn.style.color = '#fff';
            }
            
            Swal.fire({ 
                icon: 'success', 
                title: '清查模式已啟動', 
                text: '地圖已自動切換，請點擊點位進行紀錄', 
                timer: 2000, 
                showConfirmButton: false 
            });
        }
    };

    // ---------------------------------------------------------
    // 2. Firebase 監聽邏輯
    // ---------------------------------------------------------
    function startAuditListener(kmlId) {
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            console.error("[Audit] Firebase SDK 未載入");
            return;
        }
        
        // 如果已有監聽舊圖層，先卸載
        if (auditUnsubscribes[kmlId]) auditUnsubscribes[kmlId]();

        const db = firebase.firestore();
        console.log("[Audit] 開始監聽圖層: " + kmlId);

        auditUnsubscribes[kmlId] = db.collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snapshot => {
                const updates = {};
                snapshot.forEach(doc => { updates[doc.id] = doc.data(); });
                window.auditLayersState[kmlId] = updates;

                // 觸發地圖重新渲染以更新顏色
                if (window.addGeoJsonLayers && window.mapNamespace?.allKmlFeatures) {
                    window.addGeoJsonLayers(window.mapNamespace.allKmlFeatures);
                }
                // 更新底部控制按鈕狀態
                if (bottomControl) bottomControl.update();
            }, err => console.error("[Audit] 監聽失敗: ", err));
    }

    // ---------------------------------------------------------
    // 3. 影像處理與壓縮 (1024x768)
    // ---------------------------------------------------------
    window.handleAuditPhotoPreview = function(input, index) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 1024;
                    canvas.height = 768;
                    const ctx = canvas.getContext('2d');
                    
                    // 背景補白並等比縮放繪製 (強制 4:3)
                    ctx.fillStyle = "#FFFFFF";
                    ctx.fillRect(0, 0, 1024, 768);
                    ctx.drawImage(img, 0, 0, 1024, 768);

                    const base64 = canvas.toDataURL('image/jpeg', 0.8);
                    const prevImg = document.getElementById('audit-prev-' + index);
                    const icon = document.getElementById('audit-icon-' + index);
                    
                    if (prevImg) { prevImg.src = base64; prevImg.style.display = 'block'; }
                    if (icon) icon.style.display = 'none';
                    
                    if (!window.currentSelectedPoint.props.photos) window.currentSelectedPoint.props.photos = [];
                    window.currentSelectedPoint.props.photos[index] = base64;
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(input.files[0]);
        }
    };

    // ---------------------------------------------------------
    // 4. 清查編輯器 (彈窗)
    // ---------------------------------------------------------
    window.openAuditEditor = async function() {
        const point = window.currentSelectedPoint;
        if (!point) return;

        const kmlId = point.kmlId;
        const featureId = point.id;

        let photoHtml = '';
        for (let i = 0; i < 2; i++) {
            const photoData = point.props.photos?.[i] || '';
            photoHtml += `
                <div style="border:2px dashed #ccc;height:95px;position:relative;display:flex;align-items:center;justify-content:center;background:#fafafa;border-radius:8px;overflow:hidden;">
                    <input type="file" accept="image/*" capture="environment" onchange="window.handleAuditPhotoPreview(this, ${i})" style="position:absolute;width:100%;height:100%;opacity:0;z-index:2;cursor:pointer;">
                    <img id="audit-prev-${i}" src="${photoData}" style="width:100%;height:100%;object-fit:cover;display:${photoData?'block':'none'};z-index:1;">
                    <span id="audit-icon-${i}" style="font-size:28px;color:#bbb;display:${photoData?'none':'block'};z-index:1;">📷</span>
                </div>`;
        }

        const { value: res } = await Swal.fire({
            title: '點位清查: ' + (point.props.name || featureId),
            html: `<div style="text-align:left;">
                <label><b>1. 清查狀態</b></label>
                <select id="swal-status" class="swal2-input" style="width:100%;margin:10px 0 20px 0;">
                    <option value="正常" ${point.props.auditStatus==='正常'?'selected':''}>正常</option>
                    <option value="毀損" ${point.props.auditStatus==='毀損'?'selected':''}>毀損</option>
                    <option value="遺失" ${point.props.auditStatus==='遺失'?'selected':''}>遺失</option>
                </select>
                <label><b>2. 照片上傳 (1024x768)</b></label>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0;">${photoHtml}</div>
                <label><b>3. 現場備註</b></label>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%;height:60px;margin:0;">${point.props.auditNote || ''}</textarea>
            </div>`,
            showCancelButton: true,
            confirmButtonText: '儲存並上傳',
            preConfirm: () => ({
                status: document.getElementById('swal-status').value,
                note: document.getElementById('swal-note').value,
                photos: point.props.photos || []
            })
        });

        if (res) {
            Swal.fire({ title: '上傳處理中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            try {
                const photoUrls = [];
                for (let i = 0; i < res.photos.length; i++) {
                    const data = res.photos[i];
                    if (data && data.startsWith('data:image')) {
                        const fileRef = firebase.storage().ref().child(`${STORAGE_ROOT}/${kmlId}/${featureId}_${i}.jpg`);
                        const blob = await (await fetch(data)).blob();
                        await fileRef.put(blob);
                        photoUrls.push(await fileRef.getDownloadURL());
                    } else if (data) {
                        photoUrls.push(data);
                    }
                }

                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(featureId).set({
                    status: res.status,
                    note: res.note,
                    photos: photoUrls,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                Swal.fire({ icon: 'success', title: '儲存成功', timer: 1000, showConfirmButton: false });
            } catch (e) {
                Swal.fire('上傳失敗', e.message, 'error');
            }
        }
    };

    // ---------------------------------------------------------
    // 5. 地圖底部 UI 與顏色攔截 (維持系統運作)
    // ---------------------------------------------------------
    document.addEventListener('DOMContentLoaded', () => {
        if (!window.mapNamespace?.map) return;
        const AuditMenu = L.Control.extend({
            options: { position: 'bottomcenter' },
            onAdd: function() {
                this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                this._container.style.display = 'none';
                return this._container;
            },
            update: function() {
                const active = window.currentSelectedPoint;
                if (!active) { this._container.style.display = 'none'; return; }
                const isDone = !!active.props.auditStatus;
                this._container.style.display = 'block';
                this._container.innerHTML = `
                    <button onclick="event.stopPropagation(); window.openAuditEditor()" 
                            style="background:${isDone?'#ff85c0':'#3498db'};color:white;border:3px solid #fff;padding:15px 30px;border-radius:50px;font-weight:bold;font-size:18px;box-shadow:0 4px 15px rgba(0,0,0,0.5);cursor:pointer;">
                        ${isDone ? '修改紀錄' : '開始清查點位'}
                    </button>`;
            }
        });
        bottomControl = new AuditMenu();
        bottomControl.addTo(window.mapNamespace.map);
    });

    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        if (ns?.currentKmlLayerId && window.auditLayersState[ns.currentKmlLayerId]) {
            const records = window.auditLayersState[ns.currentKmlLayerId];
            features.forEach(f => {
                const rid = f.properties.id || f.id;
                if (records[rid]) {
                    f.properties.auditStatus = records[rid].status;
                    f.properties.auditNote = records[rid].note;
                    f.properties.photos = records[rid].photos || [];
                }
                f.properties.kmlId = ns.currentKmlLayerId;
            });
        }
        return originalAddLayers ? originalAddLayers.apply(this, arguments) : null;
    };

    console.log("[Audit] 全功能獨立模組 (2026.04.14) 已載入完成。");
})();