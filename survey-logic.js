// survey-logic.js v2.3
(function() {
    let currentPointName = "";
    let selectedStatus = null;
    let surveyPhotos = [null, null, null]; 

    // 1. 定時監控面板：精確注入「開始清查」按鈕至藍框位置 (Email 右側)
    const injectInterval = setInterval(() => {
        const emailHeader = document.getElementById('userEmailDisplay');
        const dashboard = document.getElementById('loggedInDashboard');
        
        // 確保管理面板已顯示且目標存在
        if (emailHeader && dashboard && window.getComputedStyle(dashboard).display !== 'none') {
            if (!document.getElementById('startSurveyBtn')) {
                // 強制設定父層樣式以確保定位準確
                emailHeader.style.position = 'relative';
                emailHeader.style.display = 'block'; 
                
                const startBtn = document.createElement('button');
                startBtn.id = 'startSurveyBtn';
                startBtn.className = 'survey-start-trigger';
                startBtn.innerHTML = '<span class="material-symbols-outlined">assignment_turned_in</span> 開始清查';
                
                emailHeader.appendChild(startBtn);
                startBtn.onclick = () => window.showMessage('清查模式', '模式已啟動。請點擊地圖點位並使用導航下方的「清查」圖示。');
            }
        }
    }, 600);

    // 2. 地圖導航監聽：生成南方偏移的清查按鈕
    window.addEventListener('load', () => {
        if (window.map && window.navButtons) {
            window.map.on('click', () => {
                setTimeout(() => {
                    const layers = window.navButtons.getLayers();
                    if (layers.length > 0) {
                        const navPos = layers[0].getLatLng();
                        addSurveyMarker(navPos);
                    }
                }, 200);
            });
        }
    });

    function addSurveyMarker(navPos) {
        // 緯度向下偏移 (南方)
        const surveyPos = [navPos.lat - 0.00025, navPos.lng]; 
        const activeLabel = document.querySelector('.label-active');
        currentPointName = activeLabel ? activeLabel.textContent : "未知點位";

        const surveyIcon = L.divIcon({
            className: 'survey-trigger-icon',
            html: `<img src="https://cdn-icons-png.freepik.com/512/8280/8280556.png" style="width:42px; cursor:pointer;">`,
            iconSize: [42, 42], iconAnchor: [21, 21]
        });

        const m = L.marker(surveyPos, { icon: surveyIcon }).addTo(window.navButtons);
        m.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            openSurveyUI(currentPointName);
        });
    }

    // 3. 全螢幕 UI 邏輯
    function openSurveyUI(pointName) {
        const userEmail = (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.email : '訪客人員';
        selectedStatus = null;
        surveyPhotos = [null, null, null];

        const uiHtml = `
            <div id="surveyModal" class="survey-full-overlay">
                <div class="survey-scroll-container">
                    <div class="survey-header">
                        <div class="header-main">點位清查 - ${pointName}</div>
                        <div class="header-sub">人員：${userEmail}</div>
                        <button class="close-x" onclick="document.getElementById('surveyModal').remove()">×</button>
                    </div>

                    <div class="survey-section">
                        <h4 class="section-title">基本資訊</h4>
                        <div class="info-row"><span>點位編號</span><strong>${pointName}</strong></div>
                        <div class="info-row"><span>座標資訊</span><strong>已自動關聯</strong></div>
                    </div>

                    <div class="survey-section">
                        <h4 class="section-title">點位狀況</h4>
                        <div class="segmented-control">
                            <button class="cond-btn btn-exist" data-val="存在">存在</button>
                            <button class="cond-btn btn-lost" data-val="遺失">遺失</button>
                            <button class="cond-btn btn-damage" data-val="損壞">損壞</button>
                        </div>
                    </div>

                    <div class="survey-section">
                        <h4 class="section-title">文字說明</h4>
                        <textarea id="fieldDesc" rows="3" placeholder="現場環境說明..."></textarea>
                        <textarea id="fieldNote" rows="2" style="margin-top:10px" placeholder="其他備註..."></textarea>
                    </div>

                    <div class="survey-section">
                        <h4 class="section-title">現場照片 (最多3張)</h4>
                        <div class="photo-stack">
                            ${[1, 2, 3].map(i => `
                                <div class="photo-box" onclick="document.getElementById('camFile${i}').click()">
                                    <input type="file" id="camFile${i}" accept="image/*" capture="environment" style="display:none" onchange="window.handleSvPhoto(this, ${i})">
                                    <div id="boxContent${i}">
                                        <span class="material-symbols-outlined">add_a_photo</span>
                                        <p>點擊拍照 (${i})</p>
                                    </div>
                                    <img id="prevImg${i}" style="display:none; width:100%; height:100%; object-fit:cover;">
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="survey-footer">
                        <button id="cancelSv" class="btn-cancel">取消離開</button>
                        <button id="submitSv" class="btn-submit" disabled>請選取點位狀況</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', uiHtml);
        bindInternalLogic();
    }

    // 4. 面板內部互動邏輯
    function bindInternalLogic() {
        const submitBtn = document.getElementById('submitSv');
        const statusBtns = document.querySelectorAll('.cond-btn');

        // 狀況選擇邏輯
        statusBtns.forEach(btn => {
            btn.onclick = () => {
                statusBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedStatus = btn.dataset.val;
                
                // 防呆解鎖
                submitBtn.disabled = false;
                submitBtn.classList.add('active');
                submitBtn.textContent = '提交清查資料';
            };
        });

        // 照片預覽處理
        window.handleSvPhoto = function(input, index) {
            if (input.files && input.files[0]) {
                surveyPhotos[index-1] = input.files[0];
                const reader = new FileReader();
                reader.onload = function(e) {
                    document.getElementById(`boxContent${index}`).style.display = 'none';
                    const img = document.getElementById(`prevImg${index}`);
                    img.src = e.target.result;
                    img.style.display = 'block';
                };
                reader.readAsDataURL(input.files[0]);
            }
        };

        document.getElementById('cancelSv').onclick = () => document.getElementById('surveyModal').remove();
        
        // 提交功能
        submitBtn.onclick = async () => {
            submitBtn.disabled = true;
            submitBtn.textContent = '儲存中...';
            
            // 整合目前資料
            const surveyData = {
                point: currentPointName,
                status: selectedStatus,
                desc: document.getElementById('fieldDesc').value,
                note: document.getElementById('fieldNote').value,
                timestamp: new Date()
            };

            console.log("提交資料:", surveyData);
            
            setTimeout(() => {
                window.showMessage('清查完成', `點位 ${currentPointName} 已成功記錄為「${selectedStatus}」。`);
                document.getElementById('surveyModal').remove();
            }, 1000);
        };
    }
})();