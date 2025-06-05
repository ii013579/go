// 注意：以下是 main.js 的內容，它處理主要 UI 互動，
// 假設其他模組的函數 (如 loadKmlLayerFromFirestore, clearAllKmlLayers, createNavButton 等)
// 是全局可訪問的，這在您當前的非模組化設置中是可行的。
// 在更嚴謹的模組化中，這些會通過 import 導入。

document.addEventListener('DOMContentLoaded', () => {
    const editButton = document.getElementById('editButton');
    const authSection = document.getElementById('authSection');
    const searchBox = document.getElementById('searchBox');
    const searchResults = document.getElementById('searchResults');
    const kmlLayerSelect = document.getElementById('kmlLayerSelect'); // 主地圖上的 KML 選擇器

    // 編輯按鈕點擊事件：切換 authSection 的顯示狀態
    if (editButton && authSection) {
        editButton.addEventListener('click', () => {
            authSection.classList.toggle('hidden');
        });
    } else {
        console.error('Error: editButton or authSection not found.');
    }

    // 更新 searchResults 的位置和寬度
    const updateSearchResultsPosition = () => {
        if (searchBox && searchResults) {
            const searchBoxRect = searchBox.getBoundingClientRect();
            searchResults.style.top = `${searchBoxRect.bottom}px`; // 緊貼搜尋框底部
            searchResults.style.left = `${searchBoxRect.left}px`;
            searchResults.style.width = `${searchBoxRect.width}px`; // 與搜尋框寬度一致
        }
    };

    // 監聽搜尋框的輸入事件
    if (searchBox && searchResults) {
        searchBox.addEventListener('input', async (e) => {
            const query = e.target.value.trim();
            searchResults.innerHTML = ''; // 清空之前的結果

            if (query.length > 0) {
                try {
                    // 從 Firestore 搜尋 KML Features
                    // 這裡假設您的 KML Features 數據儲存在 'kml_features' 集合中
                    // 並且每個 document 有一個 'name' 字段和 'geometry' 字段
                    // 為了簡化，這裡僅演示基本的名稱包含搜尋，並限制結果數量
                    // 在實際應用中，您可能需要更高級的全文搜尋（例如使用 Algolia 或 MeiliSearch）
                    const featuresSnapshot = await db.collectionGroup('features') // 搜尋所有 KML Document 下的 features 子集合
                                                     .where('name', '>=', query)
                                                     .where('name', '<=', query + '\uf8ff')
                                                     .limit(10) // 限制結果數量
                                                     .get();

                    let results = [];
                    featuresSnapshot.forEach(doc => {
                        const featureData = doc.data();
                        if (featureData.geometry && featureData.geometry.type === 'Point' && featureData.geometry.coordinates) {
                            results.push(featureData);
                        }
                    });

                    updateSearchResultsPosition(); // 更新位置和寬度
                    searchResults.style.display = 'grid'; // 顯示為 grid

                    if (results.length === 0) {
                        const noResult = document.createElement('div');
                        noResult.className = 'result-item';
                        noResult.textContent = '沒有找到結果';
                        searchResults.appendChild(noResult);
                    } else {
                        results.forEach(f => {
                            const name = f.name || '未命名';
                            const [lon, lat] = f.geometry.coordinates; // 假設是 [經度, 緯度]
                            const item = document.createElement('div');
                            item.className = 'result-item';
                            item.textContent = name;
                            item.title = name;
                            item.addEventListener('click', () => {
                                const originalLatLng = L.latLng(lat, lon);
                                // 檢查 map 是否已定義
                                if (typeof map !== 'undefined') {
                                    map.setView(originalLatLng, 16);
                                }
                                // 檢查 createNavButton 是否已定義
                                if (typeof createNavButton !== 'undefined') {
                                    createNavButton(originalLatLng, name);
                                }
                                searchResults.style.display = 'none';
                                searchBox.value = '';
                                console.log(`Clicked search result: ${name}, zooming to map.`);
                            });
                            searchResults.appendChild(item);
                        });
                    }
                } catch (error) {
                    console.error("搜尋 KML 資料時出錯:", error);
                    searchResults.innerHTML = `<div class="result-item" style="color: red;">搜尋失敗: ${error.message}</div>`;
                    searchResults.style.display = 'grid';
                }
            } else {
                searchResults.style.display = 'none';
            }
        });

        // 點擊搜尋結果框外部時隱藏搜尋結果
        document.addEventListener('click', (event) => {
            if (!searchResults.contains(event.target) && event.target !== searchBox) {
                searchResults.style.display = 'none';
            }
        });

        // 監聽 ESC 鍵以隱藏搜尋結果
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                searchResults.style.display = 'none';
                searchBox.value = ''; // 清空搜尋框
            }
        });

        // 如果有調整視窗大小，也更新搜尋結果的位置
        window.addEventListener('resize', updateSearchResultsPosition);
    }

    // KML 圖層選擇器的事件監聽器
    if (kmlLayerSelect && typeof window.loadKmlLayerFromFirestore === 'function' && typeof window.clearAllKmlLayers === 'function') {
        kmlLayerSelect.addEventListener('change', (event) => {
            const kmlId = event.target.value;
            if (kmlId) {
                window.loadKmlLayerFromFirestore(kmlId);
            } else {
                window.clearAllKmlLayers(); // 如果選擇空選項則清除所有 KML
            }
        });
    }
});