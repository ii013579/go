// auth-kml-management.js v4.2.31

document.addEventListener('DOMContentLoaded', () => {
    // 獲取所有相關的 DOM 元素
    const loginForm = document.getElementById('loginForm');
    const loggedInDashboard = document.getElementById('loggedInDashboard');
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginMessage = document.getElementById('loginMessage');
    const userEmailDisplay = document.getElementById('userEmailDisplay');

    const uploadKmlSectionDashboard = document.getElementById('uploadKmlSectionDashboard');
    const selectedKmlFileNameDashboard = document.getElementById('selectedKmlFileNameDashboard');
    const uploadKmlSubmitBtnDashboard = document.getElementById('uploadKmlSubmitBtnDashboard');
    const hiddenKmlFileInput = document.getElementById('hiddenKmlFileInput'); // 新增這行
    const deleteKmlSectionDashboard = document.getElementById('deleteKmlSectionDashboard');
    const kmlLayerSelectDashboard = document.getElementById('kmlLayerSelectDashboard');
    const deleteSelectedKmlBtn = document.getElementById('deleteSelectedKmlBtn');

    const registrationSettingsSection = document.getElementById('registrationSettingsSection');
    const generateRegistrationCodeBtn = document.getElementById('generateRegistrationCodeBtn');
    const registrationCodeDisplay = document.getElementById('registrationCodeDisplay');
    const registrationCodeCountdown = document.getElementById('registrationCodeCountdown');
    let registrationCodeTimer = null; // 定義計時器變數

    // 用戶管理相關 DOM 元素
    const userManagementSection = document.getElementById('userManagementSection');
    const refreshUsersBtn = document.getElementById('refreshUsersBtn');
    const userListContainer = document.getElementById('userListContainer');

    // 登入狀態監聽
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            loggedInDashboard.style.display = 'block';
            loginForm.style.display = 'none';
            userEmailDisplay.textContent = user.email;

            // 獲取用戶角色
            const userDoc = await db.collection('users').doc(user.uid).get();
            const userData = userDoc.data();
            window.currentUserRole = userData ? userData.role : 'viewer'; // 儲存到全局變數
            console.log("當前用戶角色:", window.currentUserRole);

            // 根據用戶角色顯示/隱藏功能
            if (window.currentUserRole === 'owner') {
                uploadKmlSectionDashboard.style.display = 'block';
                deleteKmlSectionDashboard.style.display = 'block';
                registrationSettingsSection.style.display = 'block';
                userManagementSection.style.display = 'block'; // 顯示用戶管理區塊
                refreshUserList(); // 首次載入時刷新用戶列表
            } else if (window.currentUserRole === 'editor') {
                uploadKmlSectionDashboard.style.display = 'block';
                deleteKmlSectionDashboard.style.display = 'block';
                registrationSettingsSection.style.display = 'none'; // 編輯者不能生成註冊碼
                userManagementSection.style.display = 'none'; // 編輯者不能管理用戶
            } else { // viewer
                uploadKmlSectionDashboard.style.display = 'none';
                deleteKmlSectionDashboard.style.display = 'none';
                registrationSettingsSection.style.display = 'none';
                userManagementSection.style.display = 'none';
            }

            // 載入 KML 圖層選單
            loadKmlLayersToSelect();
            // 加載所有 KML 圖層到地圖
            loadAllKmlLayersToMap();

        } else {
            loggedInDashboard.style.display = 'none';
            loginForm.style.display = 'block';
            userEmailDisplay.textContent = '';
            window.currentUserRole = null; // 清除全局角色

            // 清空地圖上的所有 KML 圖層
            if (window.clearAllKmlLayersFromMap) {
                window.clearAllKmlLayersFromMap();
            }
        }
    });

    // Google 登入
    googleSignInBtn.addEventListener('click', async () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            await auth.signInWithPopup(provider);
        } catch (error) {
            console.error("Google 登入失敗:", error);
            if (error.code === 'auth/popup-closed-by-user') {
                showMessage('登入取消', '您已取消 Google 登入。');
            } else if (error.code === 'auth/cancelled-popup-request') {
                showMessage('登入失敗', '已阻止重複的彈出視窗請求。請重試。');
            } else {
                showMessage('登入失敗', `登入時發生錯誤: ${error.message}`);
            }
        }
    });

    // 登出
    logoutBtn.addEventListener('click', async () => {
        try {
            await auth.signOut();
            showMessage('登出成功', '您已成功登出。');
        } catch (error) {
            console.error("登出失敗:", error);
            showMessage('登出失敗', `登出時發生錯誤: ${error.message}`);
        }
    });

    // KML 檔案選擇
    if (hiddenKmlFileInput && selectedKmlFileNameDashboard) {
        hiddenKmlFileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                selectedKmlFileNameDashboard.textContent = file.name;
                uploadKmlSubmitBtnDashboard.disabled = false;
            } else {
                selectedKmlFileNameDashboard.textContent = '未選擇檔案';
                uploadKmlSubmitBtnDashboard.disabled = true;
            }
        });
    }

    // 上傳 KML 檔案
    if (uploadKmlSubmitBtnDashboard) {
        uploadKmlSubmitBtnDashboard.addEventListener('click', async () => {
            if (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor') {
                showMessage('權限不足', '只有管理員和編輯者可以上傳 KML 檔案。');
                return;
            }

            const file = hiddenKmlFileInput.files[0];
            if (!file) {
                showMessage('錯誤', '請先選擇一個 KML 檔案。');
                return;
            }

            if (file.type !== 'application/vnd.google-earth.kml+xml' && !file.name.toLowerCase().endsWith('.kml')) {
                showMessage('錯誤', '請選擇有效的 KML 檔案 (.kml)。');
                return;
            }

            const fileName = file.name;
            const kmlLayerName = prompt('請輸入此 KML 圖層的名稱 (將用於顯示):', fileName.replace(/\.kml$/i, ''));

            if (!kmlLayerName) {
                showMessage('提示', '已取消上傳。');
                return;
            }

            try {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const kmlText = e.target.result;
                    await uploadKmlDataToFirestore(kmlText, kmlLayerName, fileName);
                    showMessage('成功', `${kmlLayerName} 已成功上傳！`);
                    loadKmlLayersToSelect(); // 重新載入選單
                    loadAllKmlLayersToMap(); // 重新載入地圖上的所有 KML 圖層
                    // 重置檔案輸入框
                    hiddenKmlFileInput.value = '';
                    selectedKmlFileNameDashboard.textContent = '未選擇檔案';
                    uploadKmlSubmitBtnDashboard.disabled = true;
                };
                reader.readAsText(file);
            } catch (error) {
                console.error("處理 KML 檔案或上傳時發生錯誤:", error);
                showMessage('錯誤', `處理 KML 檔案或上傳時發生錯誤: ${error.message}`);
            }
        });
    }

    /**
     * 將 KML 數據轉換為 GeoJSON 並上傳到 Firestore。
     * @param {string} kmlText KML 檔案的文本內容。
     * @param {string} kmlLayerName 用戶為此 KML 圖層指定的名稱。
     * @param {string} originalFileName 原始 KML 檔案名稱。
     */
    async function uploadKmlDataToFirestore(kmlText, kmlLayerName, originalFileName) {
        const kmlLayersRef = db.collection('artifacts').doc('kmldata-' + appId).collection('public').doc('data').collection('kmlLayers');

        // 使用一個庫來解析 KML 到 GeoJSON，這裡假設您有一個 kml-to-geojson 庫或類似的函數
        // 如果沒有，您可能需要自己實現或引入一個：例如 `tokml` 和 `geojson-to-kml` 類似功能的庫
        // 為了演示，我們假設一個簡化的 KML 到 GeoJSON 轉換。
        // 在實際應用中，您可能需要一個更強大的 KML 解析器。

        // 這裡我們假設使用了一個名為 `kmlToGeoJSON` 的函數，它將 KML 字符串轉換為 GeoJSON 對象
        // 如果您沒有這樣的函數，可以考慮引入一個庫，例如 @tmcw/togeojson
        // 例如：
        // const { kml } = togeojson;
        // const geojsonData = kml(new DOMParser().parseFromString(kmlText, 'text/xml'));

        // 為了簡化和示範，我將模擬一個簡單的 GeoJSON 結構，並專注於處理幾何類型
        // 實際應用中，您會從一個 KML 解析庫獲得 geojsonData

        let geojsonData;
        try {
            // 這是一個佔位符，您需要替換為實際的 KML 解析邏輯
            // 例如，如果使用 @tmcw/togeojson
            const parser = new DOMParser();
            const kmlDom = parser.parseFromString(kmlText, 'text/xml');
            const { kml } = window.togeojson; // 假設 togeojson 已經全局可用
            geojsonData = kml(kmlDom);

            if (!geojsonData || !geojsonData.features) {
                throw new Error('無法將 KML 轉換為 GeoJSON 或 GeoJSON 結構無效。');
            }
        } catch (error) {
            console.error("KML 轉換 GeoJSON 失敗:", error);
            throw new Error(`KML 轉換 GeoJSON 失敗: ${error.message}`);
        }

        const newKmlLayerRef = kmlLayersRef.doc(); // 讓 Firestore 自動生成 ID
        const batch = db.batch();

        // 儲存 KML 圖層的元數據
        batch.set(newKmlLayerRef, {
            name: kmlLayerName,
            originalFileName: originalFileName,
            uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
            uploadedBy: auth.currentUser.email,
            id: newKmlLayerRef.id // 儲存 ID 方便後續查詢
        });

        // 儲存每個地理特徵
        geojsonData.features.forEach(feature => {
            if (feature.geometry) {
                // 創建一個新的 feature 對象來儲存修改後的 geometry，避免直接修改原始對象
                let processedFeature = { ...feature };

                if (feature.geometry.type === 'LineString') {
                    // 扁平化 LineString 的座標：將 [[lon1, lat1], [lon2, lat2]] 轉換為 [lon1, lat1, lon2, lat2]
                    const flatCoordinates = [];
                    feature.geometry.coordinates.forEach(coordPair => {
                        flatCoordinates.push(coordPair[0]); // 經度
                        flatCoordinates.push(coordPair[1]); // 緯度
                        if (coordPair.length > 2) { // 如果有高度資訊
                            flatCoordinates.push(coordPair[2]);
                        }
                    });
                    processedFeature.geometry = {
                        ...feature.geometry,
                        coordinates: flatCoordinates
                    };
                } else if (feature.geometry.type === 'Polygon') {
                    // 處理 Polygon 座標：將每個座標點轉換為 {lat: X, lng: Y} 物件陣列
                    // 因為 Polygon 是 [[[lon,lat],[lon,lat]]]，我們需要遍歷多層
                    const processedCoordinates = feature.geometry.coordinates.map(linearRing => {
                        return linearRing.map(coordPair => {
                            const coord = { lng: coordPair[0], lat: coordPair[1] };
                            if (coordPair.length > 2) { // 如果有高度資訊
                                coord.alt = coordPair[2];
                            }
                            return coord;
                        });
                    });
                    processedFeature.geometry = {
                        ...feature.geometry,
                        coordinates: processedCoordinates
                    };
                }
                // 對於 Point 或其他不含巢狀陣列的類型，無需特殊處理
                batch.set(newKmlLayerRef.collection('features').doc(), processedFeature);
            }
        });

        await batch.commit();
        console.log("KML 數據和圖層元數據已成功上傳到 Firestore。");
    }

    // 載入 KML 圖層到下拉選單
    async function loadKmlLayersToSelect() {
        if (!kmlLayerSelectDashboard) return;
        kmlLayerSelectDashboard.innerHTML = '<option value="">請選擇一個 KML 圖層</option>';
        const kmlLayersRef = db.collection('artifacts').doc('kmldata-' + appId).collection('public').doc('data').collection('kmlLayers');

        try {
            const snapshot = await kmlLayersRef.orderBy('uploadTime', 'desc').get();
            if (snapshot.empty) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = '沒有可用的 KML 圖層';
                option.disabled = true;
                kmlLayerSelectDashboard.appendChild(option);
                deleteSelectedKmlBtn.disabled = true;
                return;
            }

            snapshot.forEach(doc => {
                const data = doc.data();
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = `${data.name} (${new Date(data.uploadTime.toDate()).toLocaleDateString()})`;
                kmlLayerSelectDashboard.appendChild(option);
            });
            deleteSelectedKmlBtn.disabled = false; // 有圖層可選時啟用刪除按鈕

            // 觸發一次 change 事件，以便在初始化時更新地圖，如果沒有選中的話
            const event = new Event('change');
            kmlLayerSelectDashboard.dispatchEvent(event);

        } catch (error) {
            console.error("載入 KML 圖層選單失敗:", error);
            showMessage('錯誤', `載入 KML 圖層選單失敗: ${error.message}`);
        }
    }

    // 事件監聽器：刪除選定的 KML 圖層
    deleteSelectedKmlBtn.addEventListener('click', () => {
        if (window.currentUserRole !== 'owner') {
            showMessage('權限不足', '只有管理員可以刪除 KML 圖層。');
            return;
        }

        const selectedKmlLayerId = kmlLayerSelectDashboard.value;
        if (!selectedKmlLayerId) {
            showMessage('提示', '請選擇一個要刪除的 KML 圖層。');
            return;
        }

        // 顯示確認模態框
        window.showConfirmation(`確認刪除 "${kmlLayerSelectDashboard.options[kmlLayerSelectDashboard.selectedIndex].textContent}"？`, '此操作將永久刪除所有相關數據，無法恢復。', async (confirmed) => {
            if (confirmed) {
                try {
                    const kmlLayerRef = db.collection('artifacts').doc('kmldata-' + appId).collection('public').doc('data').collection('kmlLayers').doc(selectedKmlLayerId);

                    // 首先刪除子集合中的所有 feature
                    const featuresSnapshot = await kmlLayerRef.collection('features').get();
                    const deleteBatch = db.batch();
                    featuresSnapshot.forEach(doc => {
                        deleteBatch.delete(doc.ref);
                    });
                    await deleteBatch.commit();

                    // 然後刪除圖層本身
                    await kmlLayerRef.delete();
                    showMessage('成功', 'KML 圖層及其所有數據已成功刪除！');
                    loadKmlLayersToSelect(); // 重新載入選單
                    loadAllKmlLayersToMap(); // 重新載入地圖上的所有 KML 圖層

                } catch (error) {
                    console.error("刪除 KML 圖層失敗:", error);
                    showMessage('錯誤', `刪除 KML 圖層失敗: ${error.message}`);
                }
            } else {
                showMessage('取消', '已取消刪除操作。');
            }
        });
    });

    // 事件監聽器：生成註冊碼 (Owner Only)
    generateRegistrationCodeBtn.addEventListener('click', async () => {
        if (window.currentUserRole !== 'owner') {
            showMessage('權限不足', '只有管理員可以生成註冊碼。');
            return;
        }

        try {
            // 生成隨機的 6 位數註冊碼
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            const expiryTime = Date.now() + (60 * 1000); // 1 分鐘後過期

            await db.collection('registrationCodes').doc('currentCode').set({
                code: code,
                expiry: expiryTime,
                generatedBy: auth.currentUser.email,
                generatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            registrationCodeDisplay.textContent = `當前註冊碼: ${code}`;
            let countdownSeconds = 60; // 設置 60 秒倒數
            registrationCodeCountdown.style.display = 'inline-block';
            // registrationExpiryDisplay.style.display = 'none'; // 這個在您的原始代碼中是註釋掉的

            if (registrationCodeTimer) {
                clearInterval(registrationCodeTimer);
            }

            registrationCodeTimer = setInterval(() => {
                countdownSeconds--;
                if (countdownSeconds >= 0) {
                    registrationCodeCountdown.textContent = ` (剩餘 ${countdownSeconds} 秒)`;
                } else {
                    clearInterval(registrationCodeTimer);
                    registrationCodeTimer = null;
                    registrationCodeDisplay.textContent = '註冊碼已過期';
                    registrationCodeCountdown.style.display = 'none';
                }
            }, 1000);
            
            const tempInput = document.createElement('textarea');
            tempInput.value = code;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand('copy');
            document.body.removeChild(tempInput);

            showMessage('成功', `一次性註冊碼已生成並複製到剪貼簿，設定為 ${countdownSeconds} 秒後過期！`);
        } catch (error) {
            console.error("生成註冊碼時出錯:", error);
            showMessage('錯誤', `生成註冊碼失敗: ${error.message}`);
        }
    });

    // 事件監聽器：重新整理用戶列表 (Owner Only)
    refreshUsersBtn.addEventListener('click', () => {
        if (window.currentUserRole === 'owner') {
            refreshUserList();
        } else {
            showMessage('權限不足', '只有管理員才能管理用戶。');
        }
    });

    // 刷新用戶列表函數
    async function refreshUserList() {
        userListContainer.innerHTML = '載入中...';
        try {
            const usersRef = db.collection('users');
            const snapshot = await usersRef.get();

            userListContainer.innerHTML = ''; // 清空現有列表

            if (snapshot.empty) {
                userListContainer.innerHTML = '<p>沒有註冊用戶。</p>';
                return;
            }

            snapshot.forEach(doc => {
                const userData = doc.data();
                const userId = doc.id;
                const userEmail = userData.email || '未知郵箱';
                const userRole = userData.role || 'viewer';
                const userNickname = userData.nickname || '未設定暱稱';

                const userCard = document.createElement('div');
                userCard.className = 'user-card';
                userCard.setAttribute('data-user-id', userId); // 儲存 userId

                userCard.innerHTML = `
                    <div class="user-card-row-1">
                        <span class="user-email">${userEmail}</span>
                        <span class="user-nickname">${userNickname}</span>
                    </div>
                    <div class="user-card-row-2">
                        <div class="user-role-controls">
                            <label for="role-${userId}">角色:</label>
                            <select id="role-${userId}" class="user-role-select">
                                <option value="viewer" ${userRole === 'viewer' ? 'selected' : ''}>觀看者</option>
                                <option value="editor" ${userRole === 'editor' ? 'selected' : ''}>編輯者</option>
                                <option value="owner" ${userRole === 'owner' ? 'selected' : ''}>管理員</option>
                            </select>
                            <button class="change-role-btn action-buttons" data-user-id="${userId}" data-current-role="${userRole}">變更</button>
                        </div>
                        <div class="user-actions">
                            <button class="delete-user-btn action-buttons" data-user-id="${userId}">刪除</button>
                        </div>
                    </div>
                `;
                userListContainer.appendChild(userCard);
            });

            // 為所有變更角色按鈕添加事件監聽器
            userListContainer.querySelectorAll('.change-role-btn').forEach(button => {
                button.addEventListener('click', async (event) => {
                    const targetUserId = event.target.dataset.userId;
                    const selectElement = document.getElementById(`role-${targetUserId}`);
                    const newRole = selectElement.value;
                    const currentUserUID = auth.currentUser.uid;

                    if (window.currentUserRole !== 'owner') {
                        showMessage('權限不足', '只有管理員才能變更用戶角色。');
                        return;
                    }

                    if (targetUserId === currentUserUID && newRole !== 'owner') {
                        showMessage('警告', '您不能將自己的角色降級，請讓其他管理員操作。');
                        return;
                    }
                    
                    window.showConfirmation(`確認變更用戶角色？`, `您確定要將用戶 ${userEmail} 的角色變更為 "${newRole}" 嗎？`, async (confirmed) => {
                        if (confirmed) {
                            try {
                                await db.collection('users').doc(targetUserId).update({ role: newRole });
                                showMessage('成功', `用戶 ${userEmail} 的角色已更新為 ${newRole}。`);
                                refreshUserList(); // 更新列表
                            } catch (error) {
                                console.error("更新用戶角色失敗:", error);
                                showMessage('錯誤', `更新用戶角色失敗: ${error.message}`);
                            }
                        } else {
                            showMessage('取消', '已取消角色變更。');
                            // 如果取消，將選單恢復到原來的角色
                            selectElement.value = event.target.dataset.currentRole;
                        }
                    });
                });
            });

            // 為所有刪除用戶按鈕添加事件監聽器
            userListContainer.querySelectorAll('.delete-user-btn').forEach(button => {
                button.addEventListener('click', async (event) => {
                    const targetUserId = event.target.dataset.userId;
                    const currentUserUID = auth.currentUser.uid;

                    if (window.currentUserRole !== 'owner') {
                        showMessage('權限不足', '只有管理員才能刪除用戶。');
                        return;
                    }
                    if (targetUserId === currentUserUID) {
                        showMessage('警告', '您不能刪除自己的帳戶。');
                        return;
                    }

                    window.showConfirmation(`確認刪除用戶？`, `您確定要刪除用戶 ${userEmail} 嗎？此操作不可逆。`, async (confirmed) => {
                        if (confirmed) {
                            try {
                                // 從 Auth 刪除用戶 (這需要在後端操作，前端無法直接刪除其他用戶)
                                // 這裡只處理 Firestore 數據，您可能需要一個 Cloud Function 來實現 Auth 用戶刪除
                                // await admin.auth().deleteUser(targetUserId); // 這是 Node.js Admin SDK 的用法

                                await db.collection('users').doc(targetUserId).delete();
                                showMessage('成功', `用戶 ${userEmail} 已從數據庫中刪除。`);
                                refreshUserList(); // 更新列表
                            } catch (error) {
                                console.error("刪除用戶失敗:", error);
                                showMessage('錯誤', `刪除用戶失敗: ${error.message}`);
                            }
                        } else {
                            showMessage('取消', '已取消刪除用戶。');
                        }
                    });
                });
            });

        } catch (error) {
            console.error("載入用戶列表失敗:", error);
            userListContainer.innerHTML = `<p>載入用戶列表失敗: ${error.message}</p>`;
            showMessage('錯誤', `載入用戶列表失敗: ${error.message}`);
        }
    }
});