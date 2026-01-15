// survey-logic.js
(function() {
    // 點擊點位時由 map-logic 調用
    window.openSurveyPanel = async function(feature, latlng) {
        const name = feature.properties.name || "未命名點位";
        
        // 建立清查 UI
        const panel = document.createElement('div');
        panel.className = 'survey-panel-floating';
        panel.innerHTML = `
            <div class="survey-header">清查點位: ${name}</div>
            <div class="survey-content">
                <label>清查狀態:</label>
                <select id="surveyStatus">
                    <option value="待清查">待清查</option>
                    <option value="已完成">已完成</option>
                    <option value="異常">異常</option>
                </select>
                <br>
                <label>備註:</label>
                <textarea id="surveyNote" rows="3"></textarea>
                <button id="saveSurveyBtn">儲存清查結果</button>
                <button onclick="this.parentElement.parentElement.remove()">關閉</button>
            </div>
        `;
        document.body.appendChild(panel);

        // 儲存邏輯 (存入專屬的 surveys 集合)
        document.getElementById('saveSurveyBtn').onclick = async () => {
            const status = document.getElementById('surveyStatus').value;
            const note = document.getElementById('surveyNote').value;

            await window.db.collection('artifacts').doc(window.appId)
                .collection('surveys').doc(window.currentKmlLayerId)
                .collection('results').doc(name).set({
                    status: status,
                    note: note,
                    checker: window.auth.currentUser.email,
                    checkTime: firebase.firestore.FieldValue.serverTimestamp()
                });
            
            window.showMessage("成功", "清查紀錄已儲存");
            panel.remove();
        };
    };
})();