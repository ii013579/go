(function() {
    let currentPointName = "";
    let selectedStatus = "";

    // 1. 初始化按鈕與地圖點擊監聽
    function init() {
        const startBtn = document.getElementById('startSurveyBtn');
        if (startBtn) {
            startBtn.onclick = (e) => {
                e.preventDefault();
                if (window.showMessage) window.showMessage('模式啟動', '請點擊地圖上的座標點。');
            };
        }

        if (window.map) {
            window.map.on('click', function() {
                // 延遲偵測 v1.9.6 的導航按鈕圖層 (navButtons)
                setTimeout(createSurveyMarker, 350);
            });
        }
    }

    // 2. 在地圖生成清查按鈕 (記事本圖示)
    function createSurveyMarker() {
        if (window.navButtons && window.navButtons.getLayers().length > 0) {
            const navMarker = window.navButtons.getLayers()[0];
            const pos = navMarker.getLatLng();
            
            // 抓取點位名稱
            const activeLabel = document.querySelector('.label-active');
            currentPointName = activeLabel ? activeLabel.textContent : "未知點位";

            // 記事本圖示樣式
            const surveyIcon = L.divIcon({
                className: 'survey-trigger-icon',
                html: '<img src="https://cdn-icons-png.freepik.com/512/8280/8280556.png" style="width:42px; cursor:pointer; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4))">',
                iconSize: [42, 42],
                iconAnchor: [21, 21]
            });

            // 向南偏移 (緯度 -0.0003) 避免與紅標重疊
            const surveyPos = [pos.lat - 0.0003, pos.lng];

            // 建立標記並綁定點擊事件
            const m = L.marker(surveyPos, { icon: surveyIcon }).addTo(window.navButtons);
            m.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                openSurveyUI(currentPointName);
            });
        }
    }

    // 3. 全螢幕 UI 渲染
    function openSurveyUI(name) {
        const userEmail = (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.email : 'ii013579@gmail.com';
        selectedStatus = "";

        const uiHtml = `
            <div id="surveyModal" class="survey-full-overlay">
                <div class="survey-scroll-container">
                    <div class="survey-header">
                        <div class="header-main">點位清查 - ${name}</div>
                        <div class="header-sub">執行員：${userEmail}</div>
                        <button class="close-x" onclick="document.getElementById('surveyModal').remove()">×</button>
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
                        <textarea id="svDesc" rows="3" placeholder="請輸入現場環境描述..."></textarea>
                    </div>

                    <div class="survey-section">
                        <h4 class="section-title">現場照片</h4>
                        <div class="photo-box" onclick="document.getElementById('svCam').click()">
                            <input type="file" id="svCam" accept="image/*" capture="environment" style="display:none" onchange="window.handleSvPrev(this)">
                            <div id="svCamHint">
                                <span class="material-symbols-outlined" style="font-size:48px; color:#ccc;">add_a_photo</span>
                                <p style="color:#999;">點擊啟動相機</p>
                            </div>
                            <img id="svImgPrev" style="display:none; width:100%; height:100%; object-fit:cover;">
                        </div>
                    </div>

                    <div class="survey-footer">
                        <button class="btn-cancel" onclick="document.getElementById('surveyModal').remove()">取消</button>
                        <button id="svSubmitBtn" class="btn-submit" disabled>提交清查資料</button>
                    </div>
                </div>
            </div>`;

        document.body.insertAdjacentHTML('beforeend', uiHtml);
        bindInternalEvents();
    }

    // 4. UI 內部功能綁定
    function bindInternalEvents() {
        const subBtn = document.getElementById('svSubmitBtn');
        const condBtns = document.querySelectorAll('.cond-btn');

        condBtns.forEach(btn => {
            btn.onclick = () => {
                condBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedStatus = btn.dataset.val;
                subBtn.disabled = false;
                subBtn.classList.add('active');
            };
        });

        window.handleSvPrev = (input) => {
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    document.getElementById('svCamHint').style.display = 'none';
                    const img = document.getElementById('svImgPrev');
                    img.src = e.target.result;
                    img.style.display = 'block';
                };
                reader.readAsDataURL(input.files[0]);
            }
        };

        subBtn.onclick = () => {
            if (window.showMessage) {
                window.showMessage('清查完成', `點位 ${currentPointName} 已記錄為 ${selectedStatus}`);
            }
            document.getElementById('surveyModal').remove();
        };
    }

    // 啟動監聽
    window.addEventListener('load', init);
})();