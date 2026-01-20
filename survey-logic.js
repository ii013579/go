// survey-logic.js v2.4 (實體按鈕版)
(function() {
    let currentPointName = "";

    // 1. 初始化按鈕功能
    window.addEventListener('load', () => {
        const startBtn = document.getElementById('startSurveyBtn');
        if (startBtn) {
            startBtn.onclick = () => {
                window.showMessage('清查模式', '模式已啟動。請點擊地圖點位並使用導航下方的「清查」圖示。');
            };
        }
        initMapObserver();
    });

    // 2. 地圖監聽邏輯 (偵測 navButtons 出現並在南方生成清查圖標)
    function initMapObserver() {
        if (!window.map) return;
        
        window.map.on('click', () => {
            setTimeout(() => {
                if (window.navButtons && window.navButtons.getLayers().length > 0) {
                    const navPos = window.navButtons.getLayers()[0].getLatLng();
                    addSurveyMarker(navPos);
                }
            }, 200);
        });
    }

    function addSurveyMarker(navPos) {
        // 向南偏移約 25 公尺
        const surveyPos = [navPos.lat - 0.00025, navPos.lng]; 
        const activeLabel = document.querySelector('.label-active');
        currentPointName = activeLabel ? activeLabel.textContent : "未知點位";

        const surveyIcon = L.divIcon({
            className: 'survey-trigger-icon',
            html: `<img src="https://cdn-icons-png.freepik.com/512/8280/8280556.png" style="width:42px; cursor:pointer; filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3))">`,
            iconSize: [42, 42],
            iconAnchor: [21, 21]
        });

        // 建立標記並加入 navButtons 圖層
        const m = L.marker(surveyPos, { icon: surveyIcon }).addTo(window.navButtons);
        m.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            openSurveyUI(currentPointName); // 開啟您之前的全螢幕 UI
        });
    }

    // 3. 全螢幕 UI 函式 openSurveyUI(pointName) { ... 保持原本邏輯 ... }
})();