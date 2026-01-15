// ui-interactions.js (回歸舊版 ID 與結構)

document.addEventListener('DOMContentLoaded', () => {
    const editButton = document.getElementById('editButton');
    const authSection = document.getElementById('authSection');
    const controls = document.getElementById('controls');
    const pinButton = document.getElementById('pinButton');

    // 1. 編輯按鈕切換邏輯 (控制 authSection 顯示)
    if (editButton) {
        editButton.addEventListener('click', () => {
            const isAuthVisible = authSection.style.display === 'block';
            if (isAuthVisible) {
                authSection.style.display = 'none';
                controls.style.display = 'flex'; // 恢復導覽列
                editButton.textContent = '編輯';
            } else {
                authSection.style.display = 'block';
                controls.style.display = 'none'; // 隱藏導覽列
                editButton.textContent = '返回';
            }
        });
    }

    // 2. 搜尋功能 (對齊 searchBox 與 searchResults)
    const searchBox = document.getElementById('searchBox');
    const searchResults = document.getElementById('searchResults');

    if (searchBox) {
        searchBox.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            searchResults.innerHTML = '';
            
            if (!query || !window.allKmlFeatures) return;

            const matches = window.allKmlFeatures.filter(f => 
                f.properties && f.properties.name && 
                f.properties.name.toLowerCase().includes(query)
            );

            if (matches.length > 0) {
                searchResults.style.display = 'block';
                matches.slice(0, 10).forEach(f => {
                    const item = document.createElement('div');
                    item.className = 'search-result-item'; // 請確保 CSS 有對應
                    item.textContent = f.properties.name;
                    item.onclick = () => {
                        const [lon, lat] = f.geometry.coordinates;
                        window.map.setView([lat, lon], 18);
                        
                        // 觸發導覽按鈕 (survey-logic.js)
                        if (window.createNavButton) {
                            window.createNavButton(L.latLng(lat, lon), f.properties.name);
                        }
                        
                        searchResults.style.display = 'none';
                        searchBox.value = '';
                    };
                    searchResults.appendChild(item);
                });
            } else {
                searchResults.style.display = 'none';
            }
        });
    }

    // 3. 圖釘按鈕功能 (ID: pinButton)
    if (pinButton) {
        pinButton.addEventListener('click', () => {
            const currentId = document.getElementById('kmlLayerSelect').value;
            if (!currentId) {
                window.showMessage("提示", "請先選擇一個資料庫圖層再進行釘選");
                return;
            }

            const pinnedId = localStorage.getItem('pinnedKmlId');
            if (pinnedId === currentId) {
                // 取消釘選
                localStorage.removeItem('pinnedKmlId');
                pinButton.classList.remove('active');
                window.showMessage("取消成功", "已移除預設載入設定");
            } else {
                // 設定釘選
                localStorage.setItem('pinnedKmlId', currentId);
                pinButton.classList.add('active');
                window.showMessage("釘選成功", "下次開啟網頁將自動載入此圖層");
            }
        });
    }
});

// 全域選單更新方法 (供 auth-kml-management 呼叫)
window.updateKmlLayerSelects = async function() {
    const select = document.getElementById('kmlLayerSelect');
    const dashSelect = document.getElementById('kmlLayerSelectDashboard');
    if (!select) return;

    try {
        const snap = await window.db.collection('artifacts').doc(window.appId)
            .collection('public').doc('data').collection('kmlLayers')
            .orderBy('uploadTime', 'desc').get();

        let html = '<option value="">-- 請選擇 KML --</option>';
        snap.forEach(doc => {
            html += `<option value="${doc.id}">${doc.data().name || '未命名'}</option>`;
        });

        select.innerHTML = html;
        if (dashSelect) {
            dashSelect.innerHTML = html;
            dashSelect.disabled = false;
        }

        // 同步圖釘按鈕狀態
        const pinnedId = localStorage.getItem('pinnedKmlId');
        if (pinnedId && document.getElementById('pinButton')) {
            document.getElementById('pinButton').classList.add('active');
        }
    } catch (err) {
        console.error("選單更新失敗:", err);
    }
};