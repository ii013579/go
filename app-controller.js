/**
 * app-controller.js - v1.9.6 搜尋結果增強版
 */
(function () {
    const $ = id => document.getElementById(id);
    
    document.addEventListener('DOMContentLoaded', () => {
        // 面板切換
        $('editButton')?.addEventListener('click', () => {
            const isAuth = $('authSection').style.display === 'flex';
            $('authSection').style.display = isAuth ? 'none' : 'flex';
            $('controls').style.display = isAuth ? 'flex' : 'none';
            $('editButton').textContent = isAuth ? '編輯' : '關閉';
        });

        // 搜尋邏輯
        $('searchBox')?.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            const results = (window.allKmlFeatures || []).filter(f => 
                f.properties.name?.toLowerCase().includes(query) || 
                f.properties.description?.toLowerCase().includes(query)
            );
            _renderResults(results, query.length > 0);
        });
    });

    const _renderResults = (results, show) => {
        const list = $('searchResults');
        list.innerHTML = '';
        if (!show || results.length === 0) return list.style.display = 'none';

        results.forEach(f => {
            const [lng, lat] = f.geometry.coordinates;
            const name = f.properties.name || '未命名';
            const desc = f.properties.description || '';

            const item = document.createElement('div');
            item.className = 'search-result-item';
            // 修正：搜尋視窗二行/三行排列
            item.innerHTML = `
                <div style="font-weight:600; color:#1a73e8;">${name}</div>
                <div style="font-size:12px; color:#666;">座標: ${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
                ${desc ? `<div style="font-size:11px; color:#888; margin-top:2px;">${desc}</div>` : ''}
            `;
            item.onclick = () => {
                window.map.flyTo([lat, lng], 18);
                $('searchBox').value = '';
                list.style.display = 'none';
            };
            list.appendChild(item);
        });
        list.style.display = 'block';
        $('searchContainer').classList.add('search-active');
    };
})();