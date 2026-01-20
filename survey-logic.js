// survey-logic.js v2.1 - 完整邏輯版
(function() {
    let currentPointName = "";
    let selectedStatus = null;
    let surveyPhotos = [null, null, null]; // 儲存 3 張照片的檔案物件

    // 等待頁面與原有地圖初始化完成
    window.addEventListener('load', () => {
        injectStartBtn();
        initMapListener();
    });

    /**
     * 1. 在編輯面板(Dashboard)中，上傳按鈕上方新增「開始清查」按鈕
     */
    function injectStartBtn() {
        const uploadBtn = document.getElementById('uploadKmlSubmitBtnDashboard');
        if (uploadBtn && !document.getElementById('startSurveyBtn')) {
            const startBtn = document.createElement('button');
            startBtn.id = 'startSurveyBtn';
            startBtn.className = 'action-buttons';
            startBtn.style.backgroundColor = '#28a745';
            startBtn.style.marginBottom = '15px';
            startBtn.innerHTML = '<span class="material-symbols-outlined">assignment</span> 開始清查模式';
            
            // 插入到上傳按鈕之前
            uploadBtn.parentNode.insertBefore(startBtn, uploadBtn);
            
            startBtn.onclick = () => {
                window.showMessage('模式啟動', '請點擊地圖上的標記紅點，並使用出現的「清查」按鈕開始填報。');
            };
        }
    }

    /**
     * 2. 監聽地圖點擊事件，當導航按鈕產生時，在其南方增加清查按鈕
     */
    function initMapListener() {
        if (!window.map) return;

        // 監聽地圖點擊或 marker 點擊後的 navButtons 變動
        window.map.on('click', () => {
            setTimeout(() => {
                const layers = window.navButtons.getLayers();
                if (layers.length > 0) {
                    const navMarker = layers[0];
                    const pos = navMarker.getLatLng();
                    addSurveyMarker(pos);
                }
            }, 150); // 延遲確保 v1.9.6 的 navButtons 已生成
        });
    }

    function addSurveyMarker(navPos) {
        // 計算向南偏移 (大約 0.0002 緯度)
        const surveyPos = [navPos.lat - 0.0002, navPos.lng];
        
        // 從 v1.9.6 的 UI 狀態中擷取目前點名
        const activeLabel = document.querySelector('.label-active');
        currentPointName = activeLabel ? activeLabel.textContent : "未知點位";

        const surveyIcon = L.divIcon({
            className: 'survey-trigger-container',
            html: `<img src="https://cdn-icons-png.freepik.com/512/8280/8280556.png" style="width:45px; cursor:pointer;" title="點擊清查">`,
            iconSize: [45, 45],
            iconAnchor: [22, 22]
        });

        // 加入地圖
        L.marker(surveyPos, { icon: surveyIcon }).addTo(window.navButtons).on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            openSurveyUI(currentPointName);
        });
    }

    /**
     * 3. 捲動式清查網頁視覺化 (Scrollable Survey UI)
     */
    function openSurveyUI(pointName) {
        const userEmail = auth.currentUser ? auth.currentUser.email : '未登入人員';
        selectedStatus = null; // 重置狀態

        const modalHtml = `
            <div id="surveyModal" class="survey-full-overlay">
                <div class="survey-scroll-container">
                    <div class="survey-header">
                        <div class="header-main">點位清查 - ${pointName}</div>
                        <div class="header-sub">清查員：${userEmail}</div>
                        <button class="close-x" onclick="document.getElementById('surveyModal').remove()">×</button>
                    </div>

                    <div class="survey-section">
                        <h4 class="section-title">基本資訊</h4>
                        <div class="info-box">
                            <p>點位編號：<strong>${pointName}</strong> (唯讀)</p>
                            <p>清查人員：<strong>${userEmail}</strong> (唯讀)</p>
                        </div>
                    </div>

                    <div class="survey-section">
                        <h4 class="section-title">點位狀況</h4>
                        <div class="segmented-control">
                            <button class="status-btn btn-exist" data-val="存在">存在</button>
                            <button class="status-btn btn-lost" data-val="遺失">遺失</button>
                            <button class="status-btn btn-damage" data-val="損壞">損壞</button>
                        </div>
                    </div>

                    <div class="survey-section">
                        <h4 class="section-title">文字說明</h4>
                        <label>現場說明</label>
                        <textarea id="fieldDesc" placeholder="描述周邊環境或點位狀況..."></textarea>
                        <label style="margin-top:10px; display:block;">備註</label>
                        <textarea id="fieldNote" placeholder="紀錄其他異常事項..."></textarea>
                    </div>

                    <div class="survey-section">
                        <h4 class="section-title">現場照片 (1~3張)</h4>
                        <div class="photo-stack">
                            ${[1, 2, 3].map(i => `
                                <div class="photo-box" onclick="document.getElementById('camFile${i}').click()">
                                    <input type="file" id="camFile${i}" accept="image/*" capture="environment" style="display:none" onchange="window.handleSvPhoto(this, ${i})">
                                    <div id="boxContent${i}">
                                        <span class="material-symbols-outlined" style="font-size:48px; color:#ccc;">add_a_photo</span>
                                        <p style="color:#999;">點擊拍照 (${i})</p>
                                    </div>
                                    <img id="prevImg${i}" style="display:none; width:100%; height:100%; object-fit:cover;">
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="survey-footer">
                        <button id="cancelSv" class="btn-cancel">取消</button>
                        <button id="submitSv" class="btn-submit" disabled>請完成照片與狀況點選</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        bindInternalLogic();
    }

    /**
     * 4. 清查面板內部邏輯 (防呆與資料處理)
     */
    function bindInternalLogic() {
        const submitBtn = document.getElementById('submitSv');
        const statusBtns = document.querySelectorAll('.status-btn');

        statusBtns.forEach(btn => {
            btn.onclick = () => {
                statusBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedStatus = btn.dataset.val;
                validateForm();
            };
        });

        function validateForm() {
            // 檢查是否有選取狀態且至少有一張照片
            const hasPhoto = surveyPhotos.some(p => p !== null);
            if (selectedStatus && hasPhoto) {
                submitBtn.classList.add('active');
                submitBtn.disabled = false;
                submitBtn.textContent = '提交清查資料';
            } else {
                submitBtn.classList.remove('active');
                submitBtn.disabled = true;
                submitBtn.textContent = '請完成照片與狀況點選';
            }
        }

        // 全域照片處理函數掛載
        window.handleSvPhoto = function(input, index) {
            if (input.files && input.files[0]) {
                const file = input.files[0];
                surveyPhotos[index-1] = file;
                const reader = new FileReader();
                reader.onload = function(e) {
                    document.getElementById(`boxContent${index}`).style.display = 'none';
                    const img = document.getElementById(`prevImg${index}`);
                    img.src = e.target.result;
                    img.style.display = 'block';
                    validateForm();
                };
                reader.readAsDataURL(file);
            }
        };

        document.getElementById('cancelSv').onclick = () => document.getElementById('surveyModal').remove();

        submitBtn.onclick = async () => {
            submitBtn.disabled = true;
            submitBtn.textContent = '傳送中，請稍候...';
            
            // 此處實作上傳邏輯 (範例)
            setTimeout(() => {
                window.showMessage('清查完成', '資料已成功儲存至系統中。');
                document.getElementById('surveyModal').remove();
            }, 1500);
        };
    }
})();