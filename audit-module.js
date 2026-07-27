/**
 * audit-module.js - 巡檢與點位清查模組 (v3.04 相容高效優化版)
 */

(function() {
    // ==========================================
    // 1. 全域變數與狀態初始化
    // ==========================================
    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = window.globalAuditConfigs || {};
    window.currentSelectedPoint = window.currentSelectedPoint || null;

    const STORAGE_ROOT = window.STORAGE_ROOT || 'AuditStorage';
    const APP_PATH = window.APP_PATH || 'AuditProjects';

    // ==========================================
    // 2. 工具函式 (權限、圖片壓縮與記憶體管理)
    // ==========================================

    function getUserRole() {
        if (typeof window.getUserRole === 'function') {
            return window.getUserRole();
        }
        return window.currentUserRole || 'guest';
    }

    function checkHasAuditPermission() {
        const role = getUserRole();
        if (role === 'guest') {
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'warning',
                    title: '權限不足',
                    text: '訪客帳號僅供檢視，無法進行清查填寫或修改。',
                    confirmButtonText: '確定'
                });
            } else {
                alert('權限不足：訪客帳號僅供檢視');
            }
            return false;
        }
        return true;
    }

    function canSeeAuditColors() {
        return getUserRole() !== 'guest';
    }

    // 壓縮圖片為 Blob (不走 Base64 佔用記憶體)
    function compressImageToBlob(file, maxSize = 1000, quality = 0.75) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxSize) {
                            height *= maxSize / width;
                            width = maxSize;
                        }
                    } else {
                        if (height > maxSize) {
                            width *= maxSize / height;
                            height = maxSize;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        if (blob) resolve(blob);
                        else reject(new Error('圖片壓縮失敗'));
                    }, 'image/jpeg', quality);
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // ==========================================
    // 3. 地圖與狀態處理
    // ==========================================

    function getAuditStatusColor(status) {
        if (!canSeeAuditColors()) return '#6c757d';
        switch (status) {
            case '正常': return '#28a745';
            case '毀損': return '#dc3545';
            case '遺失': return '#ffc107';
            default: return '#6c757d';
        }
    }

    window.getAuditMarkerStyle = function(feature, kmlId) {
        const pointKey = feature?.properties?.name || feature?.properties?.title || feature?.properties?.id || "未知點位";
        const record = window.auditLayersState[kmlId]?.[pointKey];
        const deviceStatus = record ? record.deviceStatus : '未清查';
        const color = getAuditStatusColor(deviceStatus);

        return {
            radius: 8,
            fillColor: color,
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        };
    };

    window.forceMapRefresh = function() {
        if (window.mapNamespace && typeof window.mapNamespace.refreshCurrentLayer === 'function') {
            window.mapNamespace.refreshCurrentLayer();
        } else if (window.currentKmlLayer && typeof window.currentKmlLayer.setStyle === 'function') {
            const kmlId = window.mapNamespace?.currentKmlLayerId;
            window.currentKmlLayer.setStyle(feature => window.getAuditMarkerStyle(feature, kmlId));
        }
    };

    // ==========================================
    // 4. Firestore 監聽與 CSV 自動同步
    // ==========================================

    window.subscribeToAuditData = function(kmlId) {
        if (!kmlId) return;

        if (window._auditUnsubscribe) {
            window._auditUnsubscribe();
            window._auditUnsubscribe = null;
        }

        window._auditUnsubscribe = firebase.firestore()
            .collection(APP_PATH)
            .doc(kmlId)
            .collection('auditRecords')
            .onSnapshot(snapshot => {
                if (!window.auditLayersState[kmlId]) {
                    window.auditLayersState[kmlId] = {};
                }

                snapshot.docChanges().forEach(change => {
                    const docData = change.doc.data();
                    const pointKey = change.doc.id;

                    if (change.type === "added" || change.type === "modified") {
                        window.auditLayersState[kmlId][pointKey] = docData;
                    } else if (change.type === "removed") {
                        delete window.auditLayersState[kmlId][pointKey];
                    }
                });

                window.forceMapRefresh();
                window.updateBottomBtnState();
            }, error => {
                console.error("即時同步清查資料失敗:", error);
            });
    };

    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos) {
        try {
            const recordsObj = window.auditLayersState[kmlId] || {};
            
            let photoHeaders = [];
            for (let i = 1; i <= maxPhotos; i++) photoHeaders.push(`照片網址_${i}`);
            
            let csvRows = [
                ['點位名稱', '清查狀態', '設備狀態', '備註說明', ...photoHeaders].join(',')
            ];

            Object.keys(recordsObj).forEach(pointKey => {
                const item = recordsObj[pointKey];
                const photosArr = item.photos || [];
                
                let row = [
                    `"${pointKey}"`,
                    `"${item.status || ''}"`,
                    `"${item.deviceStatus || ''}"`,
                    `"${(item.note || '').replace(/"/g, '""')}"`
                ];

                for (let i = 0; i < maxPhotos; i++) {
                    row.push(`"${photosArr[i] || ''}"`);
                }

                csvRows.push(row.join(','));
            });

            const csvContent = '\uFEFF' + csvRows.join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const csvStoragePath = `${STORAGE_ROOT}/${kmlLayerName}/${kmlLayerName}_清查總表.csv`;
            
            await firebase.storage().ref().child(csvStoragePath).put(blob);
        } catch (err) {
            console.error("生成 CSV 報表失敗：", err);
        }
    }

    // ==========================================
    // 5. 核心 UI 功能 (SweetAlert2)
    // ==========================================

    window.openAuditEditor = async function(isModifyMode = false) {
        if (!checkHasAuditPermission()) return;

        const activePoint = window.currentSelectedPoint;
        if (!activePoint) {
            Swal.fire('提示', '請先在地圖上選擇一個點位', 'info');
            return;
        }

        const layerProps = activePoint.feature?.properties || activePoint.properties || {};
        const pointKey = layerProps.name || layerProps.title || layerProps.id || layerProps.description || "未知點位";
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId;

        if (!kmlId) {
            Swal.fire('錯誤', '無法辨識當前圖層 ID', 'error');
            return;
        }

        const config = window.globalAuditConfigs[kmlId] || { targetPhotos: 2 };
        const maxPhotos = config.targetPhotos;

        const selectEl = document.getElementById('kmlLayerSelect');
        const rawLayerName = selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '預設區域';
        const kmlLayerName = rawLayerName.replace(/\.kml$/i, '').trim();

        const historyRecord = isModifyMode ? (window.auditLayersState[kmlId]?.[pointKey] || {}) : {};
        const existingPhotoUrls = Array.isArray(historyRecord.photos) ? [...historyRecord.photos] : new Array(maxPhotos).fill('');
        const selectedFiles = new Array(maxPhotos).fill(null);
        const tempObjectUrls = [];

        const currentStatus = historyRecord.deviceStatus || '';
        const currentNote = historyRecord.note || '';

        let photoHtml = '';
        for (let i = 0; i < maxPhotos; i++) {
            const photoUrl = existingPhotoUrls[i] || '';
            photoHtml += `
                <div style="border:2px dashed #ccc;height:85px;position:relative;display:flex;align-items:center;justify-content:center;background:#fafafa;border-radius:8px;overflow:hidden;">
                    <input type="file" accept="image/*" capture="environment" data-index="${i}" class="audit-file-input" style="position:absolute;width:100%;height:100%;opacity:0;z-index:2;cursor:pointer;">
                    <img id="audit-prev-${i}" src="${photoUrl}" style="width:100%;height:100%;object-fit:cover;display:${photoUrl ? 'block' : 'none'};z-index:1;">
                    <span id="audit-icon-${i}" style="font-size:24px;color:#bbb;display:${photoUrl ? 'none' : 'block'};z-index:1;">📷</span>
                </div>`;
        }

        const { value: formValues } = await Swal.fire({
            title: `<div style="font-size:18px;">${isModifyMode ? '修改' : '填寫'}清查紀錄：${pointKey}</div>`,
            html: `
                <div style="text-align:left;">
                    <label style="font-size:14px;"><b>設備狀態 <span style="color:red;">*必選</span></b></label>
                    <select id="swal-status" class="swal2-input" style="width:100%;margin:5px 0 15px 0;">
                        <option value="" ${!currentStatus ? 'selected' : ''}>--- 請選擇狀態 ---</option>
                        <option value="正常" ${currentStatus === '正常' ? 'selected' : ''}>正常</option>
                        <option value="毀損" ${currentStatus === '毀損' ? 'selected' : ''}>毀損</option>
                        <option value="遺失" ${currentStatus === '遺失' ? 'selected' : ''}>遺失</option>
                    </select>
                    <label style="font-size:14px;"><b>現場照片 (需拍 ${maxPhotos} 張)</b></label>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(80px, 1fr));gap:8px;margin:5px 0 15px 0;">
                        ${photoHtml}
                    </div>
                    <textarea id="swal-note" class="swal2-textarea" style="width:100%;height:60px;margin:0;" placeholder="輸入備註事項...">${currentNote}</textarea>
                </div>`,
            showCancelButton: true,
            confirmButtonText: isModifyMode ? '覆蓋更新' : '確認並上傳',
            cancelButtonText: '取消',
            didOpen: (modalEl) => {
                modalEl.querySelectorAll('.audit-file-input').forEach(input => {
                    input.addEventListener('change', (e) => {
                        const idx = e.target.getAttribute('data-index');
                        const file = e.target.files[0];
                        if (file) {
                            selectedFiles[idx] = file;
                            
                            const objectUrl = URL.createObjectURL(file);
                            tempObjectUrls.push(objectUrl);

                            const imgEl = document.getElementById(`audit-prev-${idx}`);
                            const iconEl = document.getElementById(`audit-icon-${idx}`);
                            imgEl.src = objectUrl;
                            imgEl.style.display = 'block';
                            iconEl.style.display = 'none';
                        }
                    });
                });
            },
            willClose: () => {
                tempObjectUrls.forEach(url => URL.revokeObjectURL(url));
            },
            preConfirm: () => {
                const statusValue = document.getElementById('swal-status').value;
                if (!statusValue) {
                    Swal.showValidationMessage('請選擇設備狀態');
                    return false;
                }

                let photoCount = 0;
                for (let i = 0; i < maxPhotos; i++) {
                    if (selectedFiles[i] || existingPhotoUrls[i]) photoCount++;
                }

                if (photoCount < maxPhotos) {
                    Swal.showValidationMessage(`請拍滿 ${maxPhotos} 張照片`);
                    return false;
                }

                return {
                    status: statusValue,
                    note: document.getElementById('swal-note').value
                };
            }
        });

        if (formValues) {
            Swal.fire({
                title: '正在處理並上傳資料...',
                text: '壓縮圖片與同步雲端中，請稍候',
                didOpen: () => Swal.showLoading(),
                allowOutsideClick: false
            });

            try {
                const finalPhotoUrls = [];

                for (let i = 0; i < maxPhotos; i++) {
                    const newFile = selectedFiles[i];
                    if (newFile) {
                        const imageBlob = await compressImageToBlob(newFile, 1000, 0.75);
                        const photoIndexStr = String(i + 1).padStart(2, '0');
                        
                        const customStoragePath = `${STORAGE_ROOT}/${kmlLayerName}/${pointKey}_${photoIndexStr}.jpg`;
                        const storageRef = firebase.storage().ref().child(customStoragePath);
                        
                        await storageRef.put(imageBlob);
                        const downloadUrl = await storageRef.getDownloadURL();
                        finalPhotoUrls.push(downloadUrl);
                    } else {
                        finalPhotoUrls.push(existingPhotoUrls[i]);
                    }
                }

                const structuredData = {
                    pointName: pointKey,
                    status: "已完成",
                    deviceStatus: formValues.status,
                    note: formValues.note,
                    photos: finalPhotoUrls,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
                window.auditLayersState[kmlId][pointKey] = structuredData;

                await firebase.firestore()
                    .collection(APP_PATH)
                    .doc(kmlId)
                    .collection('auditRecords')
                    .doc(pointKey)
                    .set(structuredData, { merge: true });

                generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos).catch(err => {
                    console.warn('CSV 自動更新失敗:', err);
                });

                Swal.fire({
                    icon: 'success',
                    title: '儲存成功',
                    timer: 1200,
                    showConfirmButton: false
                });

                window.forceMapRefresh();
                window.updateBottomBtnState();

            } catch (error) {
                console.error("儲存失敗:", error);
                Swal.fire('上傳失敗', error.message || '發生未知錯誤，請稍後再試', 'error');
            }
        }
    };

    // ==========================================
    // 6. 底部按鈕與選取點位控制
    // ==========================================

    window.updateBottomBtnState = function() {
        const activePoint = window.currentSelectedPoint;
        const btnFill = document.getElementById('btnFillAudit');
        const btnModify = document.getElementById('btnModifyAudit');

        if (!btnFill || !btnModify) return;

        if (!activePoint) {
            btnFill.style.display = 'none';
            btnModify.style.display = 'none';
            return;
        }

        const layerProps = activePoint.feature?.properties || activePoint.properties || {};
        const pointKey = layerProps.name || layerProps.title || layerProps.id || layerProps.description || "未知點位";
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId;

        const record = window.auditLayersState[kmlId]?.[pointKey];
        const hasRecord = record && record.status === '已完成';

        if (hasRecord) {
            btnFill.style.display = 'none';
            btnModify.style.display = 'inline-block';
        } else {
            btnFill.style.display = 'inline-block';
            btnModify.style.display = 'none';
        }
    };

    window.setSelectedPoint = function(pointLayer) {
        window.currentSelectedPoint = pointLayer;
        window.updateBottomBtnState();
    };

    // ==========================================
    // 7. 關鍵修復：導出 auditModule 模組物件與 ready 標籤
    // ==========================================
    window.auditModule = {
        isReady: true,
        init: function() {
            console.log("Audit Module v3.04 已成功載入並就緒");
            window.updateBottomBtnState();
        },
        openAuditEditor: window.openAuditEditor,
        subscribeToAuditData: window.subscribeToAuditData,
        setSelectedPoint: window.setSelectedPoint,
        updateBottomBtnState: window.updateBottomBtnState,
        forceMapRefresh: window.forceMapRefresh,
        getAuditMarkerStyle: window.getAuditMarkerStyle
    };

    // 自動執行初始化標籤通知
    if (typeof window.auditModule.init === 'function') {
        window.auditModule.init();
    }
})();