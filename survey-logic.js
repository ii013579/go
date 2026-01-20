/**
 * survey-logic.js v2.7
 * 整合實體按鈕、動態地圖標記、與捲動式清查介面
 */
(function() {
    let currentPointName = "";
    let selectedStatus = null;
    let surveyPhotos = [null, null, null]; 

    // 1. 初始化：綁定實體按鈕與地圖監聽器
    function init() {
        const startBtn = document.getElementById('startSurveyBtn');
        if (startBtn) {
            startBtn.onclick = () => {
                // 使用 v1.9.6 現有的訊息視窗通知使用者
                if (window.showMessage) {
                    window.showMessage('清查模式', '模式已啟動。請點擊地圖點位標記，並使用導航圖標下方的「清查」按鈕。');
                } else {
                    alert('清查模式已啟動。請點擊地圖點位並使用導航下方的「清查」圖標。');
                }
            };
        }

        if (window.map) {
            window.map.on('click', () => {
                // 延遲偵測 v1.9.6 產生的 navButtons 圖層
                setTimeout(() => {
                    if (window.navButtons && window.navButtons.getLayers().length > 0) {
                        const navMarker = window.navButtons.getLayers()[0];
                        addSurveyMarker(navMarker.getLatLng());
                    }
                }, 200);
            });
        }
    }

    // 2. 地圖圖層：在導航紅球南方產生清查圖示
    function addSurveyMarker(navPos) {
        // 緯度向下偏移 0.00025 (約南方 25 公尺)
        const surveyPos = [navPos.lat - 0.00025, navPos.lng]; 
        
        // 嘗試抓取 v1.9.6 的啟動點位名稱
        const activeLabel = document.querySelector('.label-active');
        currentPointName = activeLabel ? activeLabel.textContent : "未知點位";

        const surveyIcon = L.divIcon({
            className: 'survey-trigger-icon',
            html: `<img src="https://cdn-icons-png.freepik.com/512/8280/8280556.png" style="width:42px; cursor:pointer; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3))">`,
            iconSize: [42, 42],
            iconAnchor: [21, 21]
        });

        // 將清查標記加入導航圖層，會隨導航關閉自動消失
        const m = L.marker(surveyPos, { icon: surveyIcon }).addTo(window.navButtons);
        
        m.on('click', (e) => {
            L.DomEvent.stopPropagation(e); // 防止觸發地圖點擊
            openSurveyUI(currentPointName);
        });
    }

    // 3. 全螢幕 UI 渲染邏輯
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
                        <textarea id="fieldDesc" rows="3" placeholder="描述現場環境或具體狀況..."></textarea>
                        <textarea id="fieldNote" rows="2" style="margin-top:10px" placeholder="備註事項..."></textarea>
                    </div>

                    <div class="survey-section">
                        <h4 class="section-title">現場照片</h4>
                        <div class="photo-stack">
                            ${[1, 2, 3].map(i => `
                                <div class="photo-box" onclick="document.getElementById('camFile${i}').click()">
                                    <input type="file" id="camFile${i}" accept="image/*" capture="environment" style="display:none" onchange="window.handleSvPhoto(this, ${i})">
                                    <div id="boxContent${i}">
                                        <span class="material-symbols-outlined" style="font-size:40px; color:#aaa;">add_a_photo</span>
                                        <p style="margin:5px 0 0; font-size:12px; color:#999;">點擊拍照 (${i})</p>
                                    </div>
                                    <img id="prevImg${i}" style="display:none; width:100%; height:100%; object-fit:cover;">
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="survey-footer">
                        <button id="cancelSv" class="btn-cancel">取消離開</button>
                        <button id="submitSv" class="btn-submit" disabled>請先選擇點位狀況</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', uiHtml);
        bindUIEvents();
    }

    // 4. UI 內部互動綁定
    function bindUIEvents() {
        const submitBtn = document.getElementById('submitSv');
        const statusBtns = document.querySelectorAll('.cond-btn');

        // 狀況選擇邏輯
        statusBtns.forEach(btn => {
            btn.onclick = () => {
                statusBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedStatus = btn.dataset.val;
                
                // 啟用提交按鈕並變色
                submitBtn.disabled = false;
                submitBtn.classList.add('active');
                submitBtn.textContent = '提交清查資料';
            };
        });

        // 照片選擇預覽 (全域函數)
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

        // 提交與取消事件
        document.getElementById('cancelSv').onclick = () => document.getElementById('surveyModal').remove();
        
        submitBtn.onclick = async () => {
            submitBtn.disabled = true;
            submitBtn.textContent = '儲存中...';
            
            // 此處為未來資料串接處
            const finalData = {
                point: currentPointName,
                status: selectedStatus,
                desc: document.getElementById('fieldDesc').value,
                time: new Date().toLocaleString()
            };
            
            console.log("清查提交：", finalData);

            setTimeout(() => {
                if (window.showMessage) {
                    window.showMessage('儲存完成', `點位 ${currentPointName} 已成功上傳。`);
                } else {
                    alert('儲存完成');
                }
                document.getElementById('surveyModal').remove();
            }, 1000);
        };
    }

    // 啟動腳本
    window.addEventListener('load', init);
})();