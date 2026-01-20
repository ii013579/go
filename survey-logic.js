/**
 * survey-logic.js v2.5
 * 實體按鈕綁定 + 地圖清查圖標 + 捲動式全螢幕 UI
 */
(function() {
    let currentPointName = "";
    let selectedStatus = null;
    let surveyPhotos = [null, null, null]; 

    // 1. 初始化：綁定實體按鈕功能與地圖監聽
    window.addEventListener('load', () => {
        // 綁定 HTML 中已建立的實體按鈕
        const startBtn = document.getElementById('startSurveyBtn');
        if (startBtn) {
            startBtn.onclick = () => {
                window.showMessage('清查模式', '模式已啟動。請點擊地圖點位標記，並使用導航圖標下方的「清查」按鈕。');
            };
        }
        
        // 啟動地圖圖標監視器
        initMapObserver();
    });

    // 2. 地圖互動邏輯
    function initMapObserver() {
        if (!window.map) return;
        
        // 監聽地圖點擊事件，偵測 v1.9.6 的導航按鈕圖層 (navButtons)
        window.map.on('click', () => {
            setTimeout(() => {
                if (window.navButtons && window.navButtons.getLayers().length > 0) {
                    const navMarker = window.navButtons.getLayers()[0];
                    addSurveyMarker(navMarker.getLatLng());
                }
            }, 200); // 延遲以確保 navButtons 已更新
        });
    }

    function addSurveyMarker(navPos) {
        // 定位：導航按鈕南方偏移 (緯度 -0.00025)
        const surveyPos = [navPos.lat - 0.00025, navPos.lng]; 
        
        // 取得當前選中的點位名稱 (從 v1.9.6 的 UI 標籤取得)
        const activeLabel = document.querySelector('.label-active');
        currentPointName = activeLabel ? activeLabel.textContent : "未知點位";

        const surveyIcon = L.divIcon({
            className: 'survey-trigger-icon',
            html: `<img src="https://cdn-icons-png.freepik.com/512/8280/8280556.png" style="width:42px; cursor:pointer;">`,
            iconSize: [42, 42],
            iconAnchor: [21, 21]
        });

        // 建立清查標記並加入 navButtons 圖層 (隨導航按鈕一同清除)
        const m = L.marker(surveyPos, { icon: surveyIcon }).addTo(window.navButtons);
        
        m.on('click', (e) => {
            L.DomEvent.stopPropagation(e); // 防止觸發地圖底層點擊
            openSurveyUI(currentPointName);
        });
    }

    // 3. 全螢幕清查 UI 渲染
    function openSurveyUI(pointName) {
        const userEmail = (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.email : '訪客人員';
        selectedStatus = null; // 重置狀態
        surveyPhotos = [null, null, null]; // 重置照片暫存

        const uiHtml = `
            <div id="surveyModal" class="survey-full-overlay">
                <div class="survey-scroll-container">
                    <div class="survey-header">
                        <div class="header-main">點位清查 - ${pointName}</div>
                        <div class="header-sub">清查員：${userEmail}</div>
                        <button class="close-x" onclick="document.getElementById('surveyModal').remove()">×</button>
                    </div>

                    <div class="survey-section">
                        <h4 class="section-title">基本資訊</h4>
                        <div class="info-row"><span>點位編號</span><strong>${pointName}</strong></div>
                        <div class="info-row"><span>人員帳號</span><strong>${userEmail}</strong></div>
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
                        <textarea id="fieldDesc" rows="3" placeholder="描述現場環境狀況..."></textarea>
                        <textarea id="fieldNote" rows="2" style="margin-top:10px" placeholder="其他備註事項..."></textarea>
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
        bindUIEvents();
    }

    // 4. UI 內部事件綁定
    function bindUIEvents() {
        const submitBtn = document.getElementById('submitSv');
        const statusBtns = document.querySelectorAll('.cond-btn');

        // 狀態選擇按鈕邏輯
        statusBtns.forEach(btn => {
            btn.onclick = () => {
                statusBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedStatus = btn.dataset.val;
                
                // 解鎖提交按鈕
                submitBtn.disabled = false;
                submitBtn.classList.add('active');
                submitBtn.textContent = '提交清查資料';
            };
        });

        // 照片選擇與預覽 (全域掛載)
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
                };
                reader.readAsDataURL(file);
            }
        };

        // 取消按鈕
        document.getElementById('cancelSv').onclick = () => {
            document.getElementById('surveyModal').remove();
        };
        
        // 提交按鈕
        submitBtn.onclick = async () => {
            submitBtn.disabled = true;
            submitBtn.textContent = '正在儲存資料...';
            
            // 這裡未來可串接 Firebase 上傳邏輯
            setTimeout(() => {
                window.showMessage('清查完成', `點位 ${currentPointName} 已成功儲存為「${selectedStatus}」。`);
                document.getElementById('surveyModal').remove();
            }, 1200);
        };
    }
})();