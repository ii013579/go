// survey-logic.js - 配合 v1.9.6 樣式之清查邏輯
(function() {
    let currentFeature = null;
    let selectedCondition = null;

    // 1. 開啟清查面板
    window.openSurveyPanel = function(feature, latlng) {
        currentFeature = feature;
        selectedCondition = null; // 重置選擇

        const name = feature.properties.name || "未命名圖徵";
        
        // 建立面板 HTML 結構 (對接 CSS 樣式)
        const panelHtml = `
            <div id="surveyPanel" class="survey-scroll-container" style="position:fixed; bottom:0; left:0; width:100%; z-index:3000; border-top:2px solid #2193b0; box-shadow: 0 -4px 12px rgba(0,0,0,0.2);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h3 style="margin:0; color:#2193b0;">現場清查：${name}</h3>
                    <button id="closeSurveyBtn" style="background:none; border:none; font-size:24px; cursor:pointer;">&times;</button>
                </div>
                
                <p style="font-size:14px; color:#666;">座標：${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}</p>
                
                <div style="margin:20px 0;">
                    <label style="display:block; margin-bottom:10px; font-weight:bold;">設備現況：</label>
                    <div style="display:flex; gap:10px;">
                        <button class="cond-btn" data-cond="正常">正常</button>
                        <button class="cond-btn" data-cond="異常">異常</button>
                        <button class="cond-btn" data-cond="需更換">需更換</button>
                    </div>
                </div>

                <div style="margin:20px 0;">
                    <label style="display:block; margin-bottom:10px; font-weight:bold;">備註說明：</label>
                    <textarea id="surveyNote" placeholder="請輸入現場狀況敘述..." style="width:100%; height:80px; padding:10px; border-radius:8px; border:1px solid #ddd; box-sizing:border-box;"></textarea>
                </div>

                <div style="display:flex; flex-direction:column; gap:10px;">
                    <button id="submitSurveyBtn" class="btn-submit">確認提交清查</button>
                    <button id="cancelSurveyBtn" class="btn-cancel" style="padding:12px; border-radius:8px; cursor:pointer;">取消</button>
                </div>
            </div>
        `;

        // 移除舊面板並加入新面板
        const oldPanel = document.getElementById('surveyPanel');
        if (oldPanel) oldPanel.remove();
        document.body.insertAdjacentHTML('beforeend', panelHtml);

        initPanelEvents();
    };

    // 2. 初始化面板內的所有事件
    function initPanelEvents() {
        const panel = document.getElementById('surveyPanel');
        const submitBtn = document.getElementById('submitSurveyBtn');
        const condBtns = document.querySelectorAll('.cond-btn');

        // 狀態按鈕切換邏輯
        condBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                condBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedCondition = btn.getAttribute('data-cond');
                
                // 啟用提交按鈕
                submitBtn.classList.add('active');
                submitBtn.style.cursor = 'pointer';
            });
        });

        // 關閉與取消
        const close = () => {
            panel.remove();
            // 同時移除地圖上的高亮標籤 (CSS .label-active)
            document.querySelectorAll('.marker-label span').forEach(el => el.classList.remove('label-active'));
        };

        document.getElementById('closeSurveyBtn').onclick = close;
        document.getElementById('cancelSurveyBtn').onclick = close;

        // 提交到 Firebase
        submitBtn.onclick = async () => {
            if (!selectedCondition) {
                alert("請選擇設備現況");
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = "傳送中...";

            try {
                const surveyData = {
                    targetName: currentFeature.properties.name,
                    condition: selectedCondition,
                    note: document.getElementById('surveyNote').value,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    user: window.auth.currentUser ? window.auth.currentUser.email : "匿名訪客",
                    layerId: window.currentKmlLayerId || "unknown"
                };

                // 存入 Firestore: artifacts/{appId}/public/data/surveys
                await window.db.collection('artifacts').doc(window.appId)
                    .collection('public').doc('data')
                    .collection('surveys').add(surveyData);

                window.showMessage("成功", "清查紀錄已儲存");
                close();
            } catch (err) {
                console.error("提交清查失敗:", err);
                window.showMessage("錯誤", "無法連線至資料庫");
                submitBtn.disabled = false;
                submitBtn.textContent = "確認提交清查";
            }
        };
    }
})();