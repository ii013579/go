/**
 * audit-module.js - 專業清查管理版
 * 整合：清單管理、Firebase 同步、動態 UI 邏輯、影像壓縮
 */
(function() {
    'use strict';

    // --- 內部狀態 ---
    window.auditLayersState = window.auditLayersState || {};    // 儲存點位清查紀錄
    window.globalAuditConfigs = {};                            // 儲存圖層清查設定 (isAuditing, targetPhotos)
    const auditUnsubscribes = {};
    let bottomControl = null;
    
    const STORAGE_ROOT = 'kmldata-d22fb/storage';
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';

    // ---------------------------------------------------------
    // 1. 初始化：監聽所有圖層的「清查狀態」
    // ---------------------------------------------------------
    const initGlobalConfigListener = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            setTimeout(initGlobalConfigListener, 500);
            return;
        }

        firebase.firestore().collection(APP_PATH).onSnapshot(snapshot => {
            snapshot.forEach(doc => {
                window.globalAuditConfigs[doc.id] = doc.data();
            });
            updateKmlSelectUI(); // 更新主介面下拉選單文字
            
            // 檢查當前載入的圖層是否開啟清查，若開啟則啟動數據監聽
            const currentId = window.mapNamespace?.currentKmlLayerId;
            if (currentId && window.globalAuditConfigs[currentId]?.isAuditing) {
                if (!auditUnsubscribes[currentId]) startAuditDataListener(currentId);
            }
            
            // 強制地圖重新渲染顏色
            if (window.addGeoJsonLayers && window.mapNamespace?.allKmlFeatures) {
                window.addGeoJsonLayers(window.mapNamespace.allKmlFeatures);
            }
        });
    };

    // 更新下拉選單文字：加註 " (清查中:xx張)"
    function updateKmlSelectUI() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select) return;
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
    // 2. 核心選單：清單式管理對話框
    // ---------------------------------------------------------
    window.showAuditActionModal = async function() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select) return;

        let listHtml = '<div style="max-height: 400px; overflow-y: auto; text-align: left;">';
        Array.from(select.options).forEach(opt => {
            if (!opt.value) return;
            const config = window.globalAuditConfigs[opt.value] || {};
            const isAuditing = config.isAuditing || false;
            
            listHtml += `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; border-bottom: 1px solid #eee;">
                    <span style="font-weight: bold; flex: 1;">${opt.getAttribute('data-basename')}</span>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        ${isAuditing ? 
                            `<span style="color: #ff85c0; font-size: 12px;">清查中:${config.targetPhotos}張</span>
                             <button onclick="window.toggleAuditStatus('${opt.value}', false)" style="background: #666; color: white; border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer;">關</button>` :
                            `<button onclick="window.toggleAuditStatus('${opt.value}', true)" style="background: #3498db; color: white; border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer;">開</button>`
                        }
                    </div>
                </div>`;
        });
        listHtml += '</div>';

        Swal.fire({
            title: '清查圖層管理',
            html: listHtml,
            showConfirmButton: false,
            showCloseButton: true
        });
    };

    // 切換開關邏輯
    window.toggleAuditStatus = async function(kmlId, status) {
        if (status) {
            // 開啟：設定張數
            const { value: count } = await Swal.fire({
                title: '設定照片張數',
                input: 'range',
                inputLabel: '請選擇 2~10 張',
                inputValue: 2,
                inputAttributes: { min: 2, max: 10, step: 1 }
            });
            if (count) {
                await firebase.firestore().collection(APP_PATH).doc(kmlId).update({
                    isAuditing: true,
                    targetPhotos: parseInt(count)
                });
                startAuditDataListener(kmlId);
            }
        } else {
            // 關閉
            const confirm = await Swal.fire({
                title: '關閉清查',
                text: '關閉後該圖層將恢復紅點標記',
                icon: 'warning',
                showCancelButton: true
            });
            if (confirm.isConfirmed) {
                await firebase.firestore().collection(APP_PATH).doc(kmlId).update({
                    isAuditing: false
                });
                if (auditUnsubscribes[kmlId]) {
                    auditUnsubscribes[kmlId]();
                    delete auditUnsubscribes[kmlId];
                }
            }
        }
        window.showAuditActionModal(); // 刷新清單
    };

    // ---------------------------------------------------------
    // 3. 數據與 UI 更新邏輯
    // ---------------------------------------------------------
    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        const db = firebase.firestore();
        auditUnsubscribes[kmlId] = db.collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snapshot => {
                const updates = {};
                snapshot.forEach(doc => updates[doc.id] = doc.data());
                window.auditLayersState[kmlId] = updates;
                if (window.addGeoJsonLayers && window.mapNamespace?.allKmlFeatures) {
                    window.addGeoJsonLayers(window.mapNamespace.allKmlFeatures);
                }
            });
    }

    // AOP 攔截顏色渲染
    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        if (ns?.currentKmlLayerId) {
            const kmlId = ns.currentKmlLayerId;
            const config = window.globalAuditConfigs[kmlId];
            const records = window.auditLayersState[kmlId] || {};

            features.forEach(f => {
                const rid = f.properties.id || f.id;
                f.properties.kmlId = kmlId;
                
                // 如果該圖層正在清查中
                if (config?.isAuditing) {
                    const record = records[rid];
                    if (record) {
                        f.properties.auditStatus = record.status;
                        f.properties.photos = record.photos || [];
                    } else {
                        f.properties.auditStatus = null; // 未清查
                    }
                } else {
                    // 非清查模式，清除相關狀態（恢復紅點）
                    delete f.properties.auditStatus;
                }
            });
        }
        return originalAddLayers ? originalAddLayers.apply(this, arguments) : null;
    };

    // ---------------------------------------------------------
    // 4. 地圖底部「清樁」按鈕與編輯器
    // ---------------------------------------------------------
    document.addEventListener('DOMContentLoaded', () => {
        if (!window.mapNamespace?.map) return;
        
        const AuditMenu = L.Control.extend({
            options: { position: 'bottomcenter' },
            onAdd: function() {
                this._container = L.DomUtil.create('div', 'audit-bottom-menu-container');
                this._container.style.display = 'none';
                return this._container;
            },
            update: function() {
                const active = window.currentSelectedPoint;
                const kmlId = window.mapNamespace?.currentKmlLayerId;
                const config = window.globalAuditConfigs[kmlId];

                // 只有在「開啟清查」的圖層且「有點擊點位」時才顯示
                if (active && config?.isAuditing) {
                    this._container.style.display = 'block';
                    this._container.innerHTML = `
                        <button onclick="window.openAuditEditor()" 
                                style="background:#3498db; color:white; border:3px solid #fff; padding:15px 40px; border-radius:50px; font-weight:bold; font-size:18px; box-shadow:0 4px 15px rgba(0,0,0,0.5); cursor:pointer;">
                            清樁
                        </button>`;
                } else {
                    this._container.style.display = 'none';
                }
            }
        });
        bottomControl = new AuditMenu();
        bottomControl.addTo(window.mapNamespace.map);
    });

    // 清查編輯器 (4. 內容)
    window.openAuditEditor = async function() {
        const point = window.currentSelectedPoint;
        if (!point) return;

        // 點擊後按鈕立即消失
        if (bottomControl) bottomControl._container.style.display = 'none';

        const kmlId = point.kmlId;
        const featureId = point.id;
        const config = window.globalAuditConfigs[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos;

        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const photoData = point.props.photos?.[i] || '';
            photoHtml += `
                <div style="border:2px dashed #ccc;height:85px;position:relative;display:flex;align-items:center;justify-content:center;background:#fafafa;border-radius:8px;overflow:hidden;">
                    <input type="file" accept="image/*" capture="environment" onchange="window.handleAuditPhotoPreview(this, ${i})" style="position:absolute;width:100%;height:100%;opacity:0;z-index:2;cursor:pointer;">
                    <img id="audit-prev-${i}" src="${photoData}" style="width:100%;height:100%;object-fit:cover;display:${photoData?'block':'none'};z-index:1;">
                    <span id="audit-icon-${i}" style="font-size:20px;color:#bbb;display:${photoData?'none':'block'};z-index:1;">📷</span>
                </div>`;
        }

        const { value: res } = await Swal.fire({
            title: `清樁紀錄 (${maxPhotos}張)`,
            html: `<div style="text-align:left;">
                <label><b>清查狀態</b></label>
                <select id="swal-status" class="swal2-input" style="width:100%;margin:10px 0 15px 0;">
                    <option value="正常" ${point.props.auditStatus==='正常'?'selected':''}>正常</option>
                    <option value="毀損" ${point.props.auditStatus==='毀損'?'selected':''}>毀損</option>
                    <option value="遺失" ${point.props.auditStatus==='遺失'?'selected':''}>遺失</option>
                </select>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:15px;">${photoHtml}</div>
                <textarea id="swal-note" class="swal2-textarea" style="width:100%;height:60px;margin:0;" placeholder="備註...">${point.props.auditNote || ''}</textarea>
            </div>`,
            showCancelButton: true,
            confirmButtonText: '上傳儲存',
            preConfirm: () => ({ status: document.getElementById('swal-status').value, note: document.getElementById('swal-note').value, photos: point.props.photos || [] })
        });

        if (res) {
            Swal.fire({ title: '處理中...', didOpen: () => Swal.showLoading() });
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

    // 影像壓縮
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
                    if (!window.currentSelectedPoint.props.photos) window.currentSelectedPoint.props.photos = [];
                    window.currentSelectedPoint.props.photos[index] = base64;
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(input.files[0]);
        }
    };

    // 初始化監聽
    initGlobalConfigListener();

    console.log("[Audit] 專業管理版載入成功。");
})();