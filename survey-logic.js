// survey-logic.js v1.9.4
// 職責：清查專員 (處理點位詳細資訊、紀錄清查狀態、表單儲存)

(function() {
    // 1. 全域導航按鈕創建 (與 map-logic.js 中的 marker click 事件連動)
    window.createNavButton = function(latLng, name) {
        // 移除舊的導航容器 (如果存在)
        const oldNav = document.getElementById('nav-container');
        if (oldNav) oldNav.remove();

        const navContainer = document.createElement('div');
        navContainer.id = 'nav-container';
        navContainer.className = 'survey-nav-panel';

        // 查找該點位的詳細原始資料 (從快取中找)
        const feature = window.allKmlFeatures.find(f => 
            f.properties && f.properties.name === name
        );

        const description = feature?.properties?.description || "無詳細描述";

        navContainer.innerHTML = `
            <div class="survey-header">
                <h4>${name}</h4>
                <button onclick="this.parentElement.parentElement.remove()">?</button>
            </div>
            <div class="survey-body">
                <p class="description">${description}</p>
                <div class="survey-actions">
                    <button class="btn-google-map" onclick="window.open('https://www.google.com/maps/dir/?api=1&destination=${latLng.lat},${latLng.lng}', '_blank')">
                        Google 導航
                    </button>
                    <button id="openSurveyFormBtn" class="btn-survey">進入清查</button>
                </div>
            </div>
        `;

        document.body.appendChild(navContainer);

        // 綁定進入清查表單事件
        document.getElementById('openSurveyFormBtn').addEventListener('click', () => {
            openSurveyForm(name, latLng, feature);
        });
    };

    /**
     * 2. 開啟清查紀錄表單
     */
    function openSurveyForm(name, latLng, feature) {
        // 如果權限不足，提示登入
        if (window.currentUserRole === 'unapproved') {
            window.showMessage('權限不足', '請先登入並通過註冊碼驗證，才能記錄清查數據。');
            return;
        }

        // 這裡可以動態生成一個清查表單 Modal
        const surveyModal = document.createElement('div');
        surveyModal.id = 'surveyModal';
        surveyModal.className = 'modal-overlay visible';
        surveyModal.innerHTML = `
            <div class="modal-content">
                <h3>清查紀錄：${name}</h3>
                <form id="surveyDataForm">
                    <label>清查狀態：</label>
                    <select name="status" id="surveyStatus">
                        <option value="pending">待處理</option>
                        <option value="completed">已完成</option>
                        <option value="issue">有問題/需複查</option>
                    </select>
                    
                    <label>清查筆記：</label>
                    <textarea id="surveyNote" placeholder="輸入現場觀察情形..."></textarea>
                    
                    <div class="button-group">
                        <button type="button" id="saveSurveyBtn" class="btn-primary">儲存紀錄</button>
                        <button type="button" onclick="document.getElementById('surveyModal').remove()" class="btn-secondary">取消</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(surveyModal);

        // 3. 儲存清查結果至 Firestore
        document.getElementById('saveSurveyBtn').addEventListener('click', async () => {
            const status = document.getElementById('surveyStatus').value;
            const note = document.getElementById('surveyNote').value;

            try {
                // 儲存路徑：artifacts/{appId}/surveys/{kmlLayerId}/{pointName}
                const surveyRef = window.db.collection('artifacts')
                    .doc(window.appId).collection('surveys')
                    .doc(window.currentKmlLayerId).collection('records')
                    .doc(name);

                await surveyRef.set({
                    pointName: name,
                    coordinates: new firebase.firestore.GeoPoint(latLng.lat, latLng.lng),
                    status: status,
                    note: note,
                    updatedBy: window.auth.currentUser.email,
                    updateTime: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                window.showMessage('成功', '清查紀錄已存檔。');
                document.getElementById('surveyModal').remove();
                
                // (可選) 通知指揮官更新地圖圖示顏色以反映已清查狀態
                if (window.updateMarkerStyle) window.updateMarkerStyle(name, status);

            } catch (error) {
                console.error("儲存清查失敗:", error);
                window.showMessage('錯誤', '儲存失敗：' + error.message);
            }
        });
    }

    /**
     * 4. 輔助功能：ZIP 下載清查結果 (如果您 HTML 有引入 JSZip)
     */
    window.downloadSurveyReport = async function() {
        if (typeof JSZip === 'undefined') {
            window.showMessage('錯誤', '尚未載入 JSZip 函式庫，無法導出。');
            return;
        }

        const zip = new JSZip();
        // 抓取目前圖層的所有清查紀錄
        const snapshot = await window.db.collection('artifacts')
            .doc(window.appId).collection('surveys')
            .doc(window.currentKmlLayerId).collection('records').get();

        let csvContent = "點位名稱,狀態,筆記,更新者,更新時間\n";
        snapshot.forEach(doc => {
            const d = doc.data();
            csvContent += `${d.pointName},${d.status},${d.note},${d.updatedBy},${d.updateTime?.toDate()}\n`;
        });

        zip.file("清查報告.csv", "\ufeff" + csvContent); // 加 BOM 避免 Excel 亂碼
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, `Survey_Report_${window.currentKmlLayerId}.zip`);
    };

})();