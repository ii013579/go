/**
 * survey-logic.js v2.8
 * 1. 綁定實體按鈕功能
 * 2. 偵測地圖點擊並在導航鈕下方產生清查圖標
 * 3. 渲染六大區塊全螢幕捲動式 UI
 */
(function() {
    let currentPointName = "";
    let selectedStatus = null;
    let surveyPhotos = [null, null, null]; 

    // --- 1. 初始化綁定 ---
    function init() {
        // 綁定 HTML 中的實體按鈕 (您在 Email 右側建立的那顆)
        const startBtn = document.getElementById('startSurveyBtn');
        if (startBtn) {
            startBtn.onclick = () => {
                if (window.showMessage) {
                    window.showMessage('清查模式', '啟動成功！請點擊地圖上的點位標記，並使用下方的「清查」圖標。');
                } else {
                    alert('模式已啟動。請點擊地圖點位並使用導航下方的「清查」圖標。');
                }
            };
        }

        // 監聽地圖事件：當導航圖層 (navButtons) 出現時，同步產生清查圖標
        if (window.map) {
            window.map.on('click', () => {
                setTimeout(() => {
                    if (window.navButtons && window.navButtons.getLayers().length > 0) {
                        const navMarker = window.navButtons.getLayers()[0];
                        addSurveyMarker(navMarker.getLatLng());
                    }
                }, 250); // 稍微延遲確保 v1.9.6 的導航鈕已渲染
            });
        }
    }

    // --- 2. 地圖圖標邏輯 ---
    function addSurveyMarker(navPos) {
        // 定位在導航鈕南方 (緯度微調 -0.00025)
        const surveyPos = [navPos.lat - 0.00025, navPos.lng]; 
        
        // 抓取當前活動點位名稱
        const activeLabel = document.querySelector('.label-active');
        currentPointName = activeLabel ? activeLabel.textContent : "未知點位";

        const surveyIcon = L.divIcon({
            className: 'survey-trigger-icon',
            html: `<img src="https://cdn-icons-png.freepik.com/512/8280/8280556.png" style="width:42px; cursor:pointer; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3))">`,
            iconSize: [42, 42],
            iconAnchor: [21, 21]
        });

        // 將清查標記加入 navButtons 容器，使其與導航鈕同步消失
        const m = L.marker(surveyPos, { icon: surveyIcon }).addTo(window.navButtons);
        
        m.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            openSurveyUI(currentPointName);
        });
    }

    // --- 3. 全螢幕 UI 渲染 ---
    function openSurveyUI(pointName) {
        const userEmail = (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.email : 'ii013579@gmail.com';
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
                        <div class="info-row"><span>座標位置</span><strong>已自動關聯</strong></div>
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
                        <textarea id="fieldDesc" rows="3" placeholder="請輸入現場環境描述..."></textarea>
                        <textarea id="fieldNote" rows="2" style="margin-top:10px" placeholder="備註..."></textarea>
                    </div>

                    <div class="survey-section">
                        <h4 class="section-title">現場照片 (1~3張)</h4>
                        <div class="photo-stack">
                            ${[1, 2, 3].map(i => `
                                <div class="photo-box" onclick="document.getElementById('camFile${i}').click()">
                                    <input type="file" id="camFile${i}" accept="image/*" capture="environment" style="display:none" onchange="window.handleSvPhoto(this, ${i})">
                                    <div id="boxContent${i}">
                                        <span class="material-symbols-outlined" style="font-size:40px; color:#ccc;">add_a_photo</span>
                                        <p style="color:#aaa; font-size:12px;">拍照 (${i})</p>
                                    </div>
                                    <img id="prevImg${i}" style="display:none; width:100%; height:100%; object-fit:cover;">
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="survey-footer">
                        <button id="cancelSv" class="btn-cancel">取消離開</button>
                        <button id="submitSv" class="btn-submit" disabled>請完成狀況選擇</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', uiHtml);
        bindUIEvents();
    }

    // --- 4. 內部互動邏輯 ---
    function bindUIEvents() {
        const submitBtn = document.getElementById('submitSv');
        const statusBtns = document.querySelectorAll('.cond-btn');

        // 狀況按鈕切換
        statusBtns.forEach(btn => {
            btn.onclick = () => {
                statusBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedStatus = btn.dataset.val;
                
                // 啟用提交鈕並變色
                submitBtn.disabled = false;
                submitBtn.classList.add('active');
                submitBtn.textContent = '提交清查資料';
            };
        });

        // 全域照片處理函數
        window.handleSvPhoto = function(input, index) {
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    document.getElementById(`boxContent${index}`).style.display = 'none';
                    const img = document.getElementById(`prevImg${index}`);
                    img.src = e.target.result;
                    img.style.display = 'block';
                };
                reader.readAsDataURL(input.files[0]);
            }
        };

        // 取消與提交
        document.getElementById('cancelSv').onclick = () => document.getElementById('surveyModal').remove();
        
        submitBtn.onclick = async () => {
            submitBtn.disabled = true;
            submitBtn.textContent = '正在儲存...';
            
            // 模擬儲存成功
            setTimeout(() => {
                if (window.showMessage) window.showMessage('成功', `點位 ${currentPointName} 清查資料已記錄。`);
                document.getElementById('surveyModal').remove();
            }, 1000);
        };
    }

    // 啟動
    window.addEventListener('load', init);
})();