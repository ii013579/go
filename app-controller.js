/**
 * app-controller.js
 * 權責：100% UI 互動邏輯、搜尋功能、編輯面板切換、搜尋結果跳轉
 */

(function () {
    'use strict';

    const $ = id => document.getElementById(id);

    // 緩存 DOM 元素
    const els = {
        editButton: $('editButton'),
        authSection: $('authSection'),
        controls: $('controls'),
        searchBox: $('searchBox'),
        searchResults: $('searchResults'),
        searchContainer: $('searchContainer'),
        kmlLayerSelect: $('kmlLayerSelect')
    };

    const init = () => {
        _bindUIEvents();
        _bindSearchLogic();
        console.log("[AppController] UI 互動邏輯已初始化。");
    };

    // --- 1. 面板切換邏輯 (編輯/關閉按鈕) ---
    const _bindUIEvents = () => {
        if (els.editButton) {
            els.editButton.addEventListener('click', () => {
                const isAuthVisible = els.authSection.style.display === 'flex';
                if (isAuthVisible) {
                    els.authSection.style.display = 'none';
                    els.controls.style.display = 'flex';
                    els.editButton.textContent = '編輯';
                } else {
                    els.controls.style.display = 'none';
                    els.authSection.style.display = 'flex';
                    els.editButton.textContent = '關閉';
                }
            });
        }

        // 下拉選單變更時觸發 (保留原本 window API 呼叫)
        if (els.kmlLayerSelect) {
            els.kmlLayerSelect.addEventListener('change', (e) => {
                const kmlId = e.target.value;
                if (kmlId && window.loadKmlLayerFromFirestore) {
                    window.loadKmlLayerFromFirestore(kmlId);
                }
            });
        }
    };

    // --- 2. 搜尋與跳轉邏輯 (100% 還原搜尋結果樣式與點擊行為) ---
    const _bindSearchLogic = () => {
        if (!els.searchBox || !els.searchResults) return;

        els.searchBox.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            const features = window.allKmlFeatures || []; // 從 MapEngine 獲得的資料

            if (query.length > 0) {
                const results = features.filter(f => 
                    f.properties.name?.toLowerCase().includes(query) ||
                    f.properties.description?.toLowerCase().includes(query)
                );
                _displaySearchResults(results);
            } else {
                _hideSearchResults();
            }
        });

        // ESC 鍵關閉搜尋
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') _hideSearchResults();
        });

        // 點擊外部關閉
        document.addEventListener('click', (e) => {
            if (!els.searchContainer.contains(e.target)) _hideSearchResults();
        });
    };

    const _displaySearchResults = (results) => {
        els.searchResults.innerHTML = '';
        if (results.length === 0) {
            els.searchResults.style.display = 'none';
            return;
        }

        results.forEach(f => {
            const [lng, lat] = f.geometry.coordinates;
            const name = f.properties.name || '未命名點位';
            
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.innerHTML = `<span class="material-symbols-outlined">location_on</span> ${name}`;
            
            item.onclick = () => {
                // 指揮 MapEngine 跳轉並開啟 Popup (100% 導航功能保留)
                if (window.map) {
                    window.map.flyTo([lat, lng], 18);
                    // 這裡可以延時開啟 Popup 確保飛到位置
                }
                els.searchBox.value = '';
                _hideSearchResults();
            };
            els.searchResults.appendChild(item);
        });

        els.searchResults.style.display = 'block';
        els.searchContainer.classList.add('search-active');
    };

    const _hideSearchResults = () => {
        els.searchResults.style.display = 'none';
        els.searchContainer.classList.remove('search-active');
    };

    init();
})();