// survey-logic.js v2.0.0
(function() {
    window.openSurveyPanel = async function(feature, latlng) {
        const name = feature.properties.name || "未知點位";
        
        // 建立 UI
        const panel = document.createElement('div');
        panel.id = 'surveyPanel';
        panel.style = "position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:white; padding:15px; border-radius:10px; box-shadow:0 0 15px rgba(0,0,0,0.3); z-index:2000; min-width:250px;";
        panel.innerHTML = `
            <h4 style="margin:0 0 10px 0">清查點位: ${name}</h4>
            <label>狀態: </label>
            <select id="s_status" style="width:100%"><option>待清查</option><option>已完成</option><option>異常</option></select><br><br>
            <label>備註: </label>
            <textarea id="s_note" style="width:100%"></textarea><br><br>
            <button id="s_save" style="background:#4CAF50; color:white; border:none; padding:5px 10px; width:100%">儲存結果</button>
            <button onclick="this.parentElement.remove()" style="margin-top:5px; width:100%">關閉</button>
        `;
        document.body.appendChild(panel);

        document.getElementById('s_save').onclick = async () => {
            const status = document.getElementById('s_status').value;
            const note = document.getElementById('s_note').value;
            await window.db.collection('artifacts').doc(window.appId)
                .collection('surveys').doc(window.currentKmlLayerId)
                .collection('results').doc(name).set({
                    status, note, 
                    user: window.auth.currentUser.email,
                    time: firebase.firestore.FieldValue.serverTimestamp()
                });
            window.showMessage("紀錄成功", `${name} 已標記為 ${status}`);
            panel.remove();
        };
    };
})();