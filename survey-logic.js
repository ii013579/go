// survey-logic.js v2.5.1
(function() {
    let currentPointName = "";
    let selectedStatus = null;
    let surveyPhotos = [null, null, null]; 

    // 1. 綁定實體按鈕
    window.addEventListener('load', () => {
        const startBtn = document.getElementById('startSurveyBtn');
        if (startBtn) {
            startBtn.onclick = () => {
                window.showMessage('清查模式', '模式已啟動。請點擊地圖標記，並使用導航圖標下方的「清查」按鈕。');
            };
        }
        initMapObserver();
    });

    // 2. 地圖監聽：生成南方偏移的清查圖標
    function initMapObserver() {
        if (!window.map) return;
        window.map.on('click', () => {
            setTimeout(() => {
                // 偵測 v1.9.6 產生的 navButtons 圖層
                if (window.navButtons && window.navButtons.getLayers().length > 0) {
                    const navPos = window.navButtons.getLayers()[0].getLatLng();
                    addSurveyMarker(navPos);
                }
            }, 200);
        });
    }

    function addSurveyMarker(navPos) {
        const surveyPos = [navPos.lat - 0.00025, navPos.lng]; 
        const activeLabel = document.querySelector('.label-active');
        currentPointName = activeLabel ? activeLabel.textContent : "未知點位";

        const surveyIcon = L.divIcon({
            className: 'survey-trigger-icon',
            html: `<img src="https://cdn-icons-png.freepik.com/512/8280/8280556.png" style="width:42px; cursor:pointer; filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3))">`,
            iconSize: [42, 42],
            iconAnchor: [21, 21]
        });

        // 加入 navButtons 圖層，會隨地圖點擊自動清除舊的
        L.marker(surveyPos, { icon: surveyIcon }).addTo(window.navButtons).on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            openSurveyUI(currentPointName);
        });
    }

    // 3. 全螢幕 UI (捲動式)
    function openSurveyUI(pointName) {
        const userEmail = (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.email : '訪客人員';
        selectedStatus = null;

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
                        <div class="info-row"><span>帳號</span><strong>${userEmail}</strong></div>
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
        bindUIEvents();
    }

    function bindUIEvents() {
        const submitBtn = document.getElementById('submitSv');
        const btns = document.querySelectorAll('.cond-btn');

        btns.forEach(btn => {
            btn.onclick = () => {
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedStatus = btn.dataset.val;
                submitBtn.disabled = false;
                submitBtn.classList.add('active');
                submitBtn.textContent = '提交清查資料';
            };
        });

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

        document.getElementById('cancelSv').onclick = () => document.getElementById('surveyModal').remove();
        submitBtn.onclick = () => {
            window.showMessage('儲存成功', `點位 ${currentPointName} 已記錄。`);
            document.getElementById('surveyModal').remove();
        };
    }
})();