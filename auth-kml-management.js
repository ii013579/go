// auth-kml-management.js

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
    const registrationExpiryDisplay = document.getElementById('registrationExpiryDisplay');

    const userManagementSection = document.getElementById('userManagementSection');
    const refreshUsersBtn = document.getElementById('refreshUsersBtn');
    const userListDiv = document.getElementById('userList');

    // 全局變數
    window.currentUserRole = null;
    let currentKmlLayers = [];
    let registrationCodeTimer = null;

    // 輔助函數：將角色英文轉換為中文
    const getRoleDisplayName = (role) => {
        switch (role) {
            case 'unapproved': return '未審核';
            case 'user': return '一般用戶';
            case 'editor': return '編輯者';
            case 'owner': return '擁有者';
            default: return role;
        }
    };

    // 輔助函數：定義角色排序
    const roleOrder = {
        'unapproved': 1,
        'user': 2,
        'editor': 3,
        'owner': 4
    };

    // 輔助函數：更新 KML 圖層選單
    const updateKmlLayerSelects = async () => {
        const kmlLayerSelect = document.getElementById('kmlLayerSelect');
        kmlLayerSelect.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
        const kmlLayerSelectDashboard = document.getElementById('kmlLayerSelectDashboard');
        kmlLayerSelectDashboard.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
        const deleteSelectedKmlBtn = document.getElementById('deleteSelectedKmlBtn');
        if (deleteSelectedKmlBtn) deleteSelectedKmlBtn.disabled = true;

        kmlLayerSelect.disabled = false;

        const canEdit = (window.currentUserRole === 'owner' || window.currentUserRole === 'editor');

        // 控制 KML 上傳和刪除區塊的顯示
        if (uploadKmlSectionDashboard) {
            uploadKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
        }
        if (deleteKmlSectionDashboard) {
            deleteKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
        }

        if (kmlLayerSelectDashboard) kmlLayerSelectDashboard.disabled = !canEdit;
        if (uploadKmlSubmitBtnDashboard) uploadKmlSubmitBtnDashboard.disabled = !canEdit;


        try {
            // IMPORTANT: 確保 Firebase 安全規則已正確設定，允許讀取以下路徑。
            const kmlRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers');
            let snapshot;

            if (window.currentUserRole === 'editor' && auth.currentUser && auth.currentUser.email) {
                snapshot = await kmlRef.where('uploadedBy', '==', auth.currentUser.email).get();
            } else {
                snapshot = await kmlRef.get();
            }

            currentKmlLayers = [];

            if (snapshot.empty) {
                console.log("沒有 KML 圖層資料。");
                return;
            }

            snapshot.forEach(doc => {
                const data = doc.data();
                const kmlId = doc.id;
                const kmlName = data.name || `KML_${kmlId.substring(0, 8)}`;
                const option = document.createElement('option');
                option.value = kmlId;
                option.textContent = kmlName;
                kmlLayerSelect.appendChild(option);

                const optionDashboard = document.createElement('option');
                optionDashboard.value = kmlId;
                optionDashboard.textContent = kmlName;
                kmlLayerSelectDashboard.appendChild(optionDashboard);

                currentKmlLayers.push({ id: kmlId, name: kmlName });
            });

            if (currentKmlLayers.length > 0) {
                if (canEdit && deleteSelectedKmlBtn) {
                    deleteSelectedKmlBtn.disabled = false;
                }
            }

            kmlLayerSelect.removeEventListener('change', handleKmlLayerSelectChange);
            kmlLayerSelect.addEventListener('change', handleKmlLayerSelectChange);


        } catch (error) {
            console.error("更新 KML 圖層列表時出錯:", error);
            showMessage('錯誤', '無法載入 KML 圖層列表。');
        }
    };

    // KML 層選擇器變更處理函數
    const handleKmlLayerSelectChange = (event) => {
        const kmlId = event.target.value;
        if (kmlId && typeof window.loadKmlLayerFromFirestore === 'function') {
            window.loadKmlLayerFromFirestore(kmlId);
        } else if (typeof window.clearAllKmlLayers === 'function') {
            window.clearAllKmlLayers();
        }
    };


    // 輔助函數：顯示用戶管理列表
    const refreshUserList = async () => {
        userListDiv.innerHTML = '載入中...';
        try {
            const usersRef = db.collection('users');
            const snapshot = await usersRef.get();
            userListDiv.innerHTML = '';

            if (snapshot.empty) {
                userListDiv.innerHTML = '<p>目前沒有註冊用戶。</p>';
                return;
            }

            let usersData = [];
            snapshot.forEach(doc => {
                const user = doc.data();
                const uid = doc.id;
                if (uid !== auth.currentUser.uid) { // 不顯示當前登入用戶
                    usersData.push({ id: uid, ...user });
                }
            });

            // 根據定義的角色順序進行排序
            usersData.sort((a, b) => {
                const roleA = roleOrder[a.role] || 99; // 如果角色未定義，則給予一個較大的值
                const roleB = roleOrder[b.role] || 99;
                return roleA - roleB;
            });


            usersData.forEach(user => {
                const uid = user.id;
                const userCard = document.createElement('div');
                userCard.className = 'user-card';
                userCard.dataset.nickname = user.name || 'N/A';
                userCard.dataset.uid = uid;

                userCard.innerHTML = `
                    <div class="user-card-row-1">
                        <span class="user-email">Email: ${user.email || 'N/A'}</span>
                        <span class="user-nickname">暱稱: ${user.name || 'N/A'}</span>
                    </div>
                    <div class="user-card-row-2">
                        <div class="user-role-controls">
                            <label for="role-select-${uid}">角色:</label>
                            <select id="role-select-${uid}" data-uid="${uid}" data-original-value="${user.role}" class="user-role-select">
                                <option value="unapproved" ${user.role === 'unapproved' ? 'selected' : ''}>${getRoleDisplayName('unapproved')}</option>
                                <option value="user" ${user.role === 'user' ? 'selected' : ''}>${getRoleDisplayName('user')}</option>
                                <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>${getRoleDisplayName('editor')}</option>
                                <option value="owner" ${user.role === 'owner' ? 'selected' : ''} ${window.currentUserRole !== 'owner' ? 'disabled' : ''}>${getRoleDisplayName('owner')}</option>
                            </select>
                        </div>
                        <div class="user-actions">
                            <button class="change-role-btn" data-uid="${uid}" disabled>變更</button>
                            <button class="delete-user-btn action-buttons delete-btn" data-uid="${uid}">刪除</button>
                        </div>
                    </div>
                `;
                userListDiv.appendChild(userCard);
            });

            userListDiv.querySelectorAll('.user-role-select').forEach(select => {
                select.dataset.originalValue = select.value;
                const changeButton = select.closest('.user-card').querySelector('.change-role-btn');

                select.addEventListener('change', (event) => {
                    changeButton.disabled = (event.target.value === select.dataset.originalValue);
                });

                changeButton.addEventListener('click', async (event) => {
                    const userCard = event.target.closest('.user-card');
                    const uidToUpdate = userCard.dataset.uid;
                    const nicknameToUpdate = userCard.dataset.nickname;
                    const newRole = select.value;
                    if (newRole === 'owner' && !confirm('確定要將此用戶設定為 Owner 嗎？Owner 擁有最高權限。')) {
                        return;
                    }

                    try {
                        await db.collection('users').doc(uidToUpdate).update({ role: newRole });
                        showMessage('成功', `用戶 ${nicknameToUpdate} (${uidToUpdate.substring(0,6)}...) 的角色已更新為 ${getRoleDisplayName(newRole)}。`);
                        select.dataset.originalValue = newRole;
                        changeButton.disabled = true;
                    } catch (error) {
                        console.error("更新用戶角色時出錯:", error);
                        showMessage('錯誤', `更新用戶角色失敗: ${error.message}`);
                        select.value = select.dataset.originalValue;
                        changeButton.disabled = true;
                    }
                });
            });

            userListDiv.querySelectorAll('.delete-user-btn').forEach(button => {
                button.addEventListener('click', async (event) => {
                    const userCard = event.target.closest('.user-card');
                    const uidToDelete = userCard.dataset.uid;
                    const nicknameToDelete = userCard.dataset.nickname;

                    if (confirm(`確定要刪除用戶 ${nicknameToDelete} (${uidToDelete.substring(0,6)}...) 嗎？此操作不可逆！`)) {
                        try {
                            await db.collection('users').doc(uidToDelete).delete();
                            showMessage('成功', `用戶 ${nicknameToDelete} (${uidToDelete.substring(0,6)}...) 已刪除。`);
                            refreshUserList();
                        } catch (error) {
                            console.error("刪除用戶時出錯:", error);
                            showMessage('錯誤', `刪除用戶失敗: ${error.message}`);
                        }
                    }
                });
            });

        } catch (error) {
            console.error("載入用戶列表時出錯:", error);
            userListDiv.innerHTML = `<p style="color: red;">載入用戶列表失敗: ${error.message}</p>`;
        }
    };


    // Firestore 實時監聽器
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            loginForm.style.display = 'none';
            loggedInDashboard.style.display = 'block';
            // 顯示用戶郵箱和角色
            userEmailDisplay.textContent = `${user.email} (${getRoleDisplayName(window.currentUserRole)})`;
            userEmailDisplay.style.display = 'block';

            db.collection('users').doc(user.uid).onSnapshot(async (doc) => {
                if (doc.exists) {
                    const userData = doc.data();
                    window.currentUserRole = userData.role || 'unapproved';

                    console.log("用戶角色:", window.currentUserRole);
                    // 更新用戶郵箱和角色顯示
                    userEmailDisplay.textContent = `${user.email} (${getRoleDisplayName(window.currentUserRole)})`;

                    const canEdit = (window.currentUserRole === 'owner' || window.currentUserRole === 'editor');
                    const isOwner = (window.currentUserRole === 'owner');

                    // 控制 KML 上傳和刪除區塊的顯示
                    if (uploadKmlSectionDashboard) {
                        uploadKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
                    }
                    if (deleteKmlSectionDashboard) {
                        deleteKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
                    }

                    uploadKmlSubmitBtnDashboard.disabled = !canEdit;
                    deleteSelectedKmlBtn.disabled = !(canEdit && currentKmlLayers.length > 0);
                    kmlLayerSelectDashboard.disabled = !canEdit;

                    registrationSettingsSection.style.display = isOwner ? 'flex' : 'none';
                    generateRegistrationCodeBtn.disabled = !isOwner;
                    registrationCodeDisplay.style.display = 'inline-block';
                    registrationCodeCountdown.style.display = 'inline-block';
                    registrationExpiryDisplay.style.display = 'none';

                    userManagementSection.style.display = isOwner ? 'block' : 'none';
                    refreshUsersBtn.disabled = !isOwner;


                    if (isOwner) {
                        refreshUserList();
                    }

                    if (window.currentUserRole === 'unapproved') {
                        showMessage('帳號審核中', '您的帳號正在等待管理員審核。在審核通過之前，您將無法上傳或刪除 KML。');
                    }

                    updateKmlLayerSelects();

                } else {
                    console.log("用戶數據不存在，為新註冊用戶創建預設數據。");
                    auth.signOut();
                    showMessage('帳號資料異常', '您的帳號資料有誤或已被移除，請重新登入或聯繫管理員。');
                }
            }, (error) => {
                // 檢查是否為登出導致的權限錯誤，如果是則不顯示訊息
                if (!auth.currentUser && error.code === 'permission-denied') {
                    console.warn("因登出導致的權限錯誤，已忽略訊息。");
                } else {
                    console.error("監聽用戶角色時出錯:", error);
                    showMessage('錯誤', `獲取用戶角色失敗: ${error.message}`);
                    auth.signOut();
                }
            });

        } else {
            loginForm.style.display = 'block';
            loggedInDashboard.style.display = 'none';
            userEmailDisplay.textContent = '';
            userEmailDisplay.style.display = 'none';
            window.currentUserRole = null;
            updateKmlLayerSelects();
        }
    });

    // 事件監聽器：Google 登入/註冊
    googleSignInBtn.addEventListener('click', async () => {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            const userCredential = await auth.signInWithPopup(provider);
            const user = userCredential.user;

            const userDoc = await db.collection('users').doc(user.uid).get();
            if (!userDoc.exists) {
                await auth.signOut(); // 登出新註冊但尚未驗證角色的用戶
                window.showRegistrationCodeModal(async (result) => {
                    if (result) {
                        const code = result.code;
                        const nickname = result.nickname;

                        try {
                            const regDoc = await db.collection('settings').doc('registration').get();
                            console.log("註冊嘗試: 用戶輸入的註冊碼:", code);
                            if (regDoc.exists) {
                                console.log("Firestore 註冊設定數據:", regDoc.data());
                                const storedCode = regDoc.data().oneTimeCode;
                                const expiryTime = regDoc.data().oneTimeCodeExpiry ? regDoc.data().oneTimeCodeExpiry.toDate() : null;
                                const currentTime = new Date();
                                console.log(`儲存的註冊碼: ${storedCode}, 過期時間: ${expiryTime}, 目前時間: ${currentTime}`);
                                console.log(`註冊碼是否匹配: ${storedCode === code}, 是否過期: ${expiryTime && currentTime > expiryTime}`);


                                if (!storedCode || storedCode !== code || (expiryTime && currentTime > expiryTime)) {
                                    showMessage('註冊失敗', '無效或過期的註冊碼。');
                                    console.error(`註冊失敗: 註冊碼不匹配或已過期。`);
                                    return;
                                }
                            } else {
                                showMessage('註冊失敗', '註冊系統未啟用或無效的註冊碼。請聯繫管理員。');
                                console.error("settings/registration 文檔不存在。");
                                return;
                            }

                            // 重新登入以確保獲取正確的用戶憑證
                            const reAuthUserCredential = await auth.signInWithPopup(provider);
                            const reAuthUser = reAuthUserCredential.user;

                            console.log("嘗試創建新用戶文檔:", {
                                uid: reAuthUser.uid,
                                email: reAuthUser.email,
                                name: nickname,
                                role: 'unapproved', // 預設為未審核
                                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                                registeredWithCode: true,
                                registrationCodeUsed: code
                            });

                            await db.collection('users').doc(reAuthUser.uid).set({
                                email: reAuthUser.email,
                                name: nickname,
                                role: 'unapproved',
                                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                                registeredWithCode: true,
                                registrationCodeUsed: code
                            });
                            console.log("新用戶文檔創建成功。");

                            // 重要提示：前端嘗試使一次性註冊碼失效。
                            // 這需要觸發此操作的用戶擁有對 `settings/registration` 文檔的寫入權限。
                            // 通常，新註冊的用戶（role: 'unapproved'）不會有這種權限，這會導致 "Missing or insufficient permissions" 錯誤。
                            // 推薦的解決方案是使用 Firebase Cloud Functions：
                            // 在用戶成功註冊後（例如，觸發 `onCreate` 用戶事件），
                            // 由後端函數安全地將 `settings/registration` 中的 `oneTimeCode` 設為 `null`。
                            // 這樣可以確保安全且不會因前端權限問題而失敗。
                            // 為了保持此版本的功能，我們將保留此行，但請注意其權限限制。
                            try {
                                await db.collection('settings').doc('registration').set({
                                    oneTimeCode: null,
                                    oneTimeCodeExpiry: null
                                }, { merge: true });
                                console.log("一次性註冊碼已在 Firestore 中失效（前端嘗試操作）。");
                                showMessage('註冊成功', `歡迎 ${reAuthUser.email} (${nickname})！您的帳號已成功註冊，正在等待審核。`);
                            } catch (codeInvalidationError) {
                                console.warn("前端嘗試使註冊碼失效時發生權限不足錯誤:", codeInvalidationError.message);
                                showMessage(
                                    '註冊待審核',
                                    `歡迎 ${reAuthUser.email} (${nickname})！您的帳號已成功註冊，正在等待審核。\n（註冊碼失效需管理員權限處理，不影響您的註冊狀態。）`
                                );
                            }

                        } catch (error) {
                            console.error("使用註冊碼登入/註冊失敗:", error);
                            if (error.code) {
                                console.error(`Firebase Error Code: ${error.code}`);
                            }
                            showMessage('註冊失敗', `使用註冊碼登入/註冊時發生錯誤: ${error.message} (請檢查安全規則)`);
                        }
                    } else {
                        showMessage('取消', '您已取消註冊。');
                    }
                });
            } else {
                showMessage('登入成功', `歡迎回來 ${user.email}！`);
            }
        }
        catch (error) {
            console.error("Google 登入失敗:", error);
            loginMessage.textContent = `登入失敗: ${error.message}`;
            showMessage('登入失敗', `Google 登入時發生錯誤: ${error.message}`);
        }
    });

    // 事件監聽器：登出
    logoutBtn.addEventListener('click', async () => {
        try {
            await auth.signOut();
            showMessage('登出成功', '用戶已登出。');
        } catch (error) {
            console.error("登出失敗:", error);
            showMessage('登出失敗', `登出時發生錯誤: ${error.message}`);
        }
    });

    // 事件監聽器：上傳 KML (Dashboard 上的按鈕，觸發文件選擇)
    uploadKmlSubmitBtnDashboard.addEventListener('click', () => {
        hiddenKmlFileInput.click();
    });

    // 監聽實際的文件選擇變化
    hiddenKmlFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            selectedKmlFileNameDashboard.textContent = file.name;
            uploadKmlSubmitBtnDashboard.disabled = false;
        } else {
            selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
            uploadKmlSubmitBtnDashboard.disabled = true;
        }
    });

    // 點擊 "尚未選擇檔案" 對話框也能選取檔案
    selectedKmlFileNameDashboard.addEventListener('click', () => {
        hiddenKmlFileInput.click();
    });


    // 實際執行上傳 KML 的函數
    uploadKmlSubmitBtnDashboard.addEventListener('click', async () => {
        const file = hiddenKmlFileInput.files[0];
        if (!file) {
            showMessage('提示', '請先選擇 KML 檔案。');
            return;
        }
        if (!auth.currentUser || (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor')) {
            showMessage('錯誤', '您沒有權限上傳 KML，請登入或等待管理員審核。');
            return;
        }

        const fileName = file.name;
        const reader = new FileReader();
        reader.onload = async () => {
            console.log(`正在處理 KML 檔案: ${file.name}`);
            try {
                const kmlString = reader.result;
                const parser = new DOMParser();
                const kmlDoc = parser.parseFromString(kmlString, 'text/xml');

                if (kmlDoc.getElementsByTagName('parsererror').length > 0) {
                    const errorText = kmlDoc.getElementsByTagName('parsererror')[0].textContent;
                    throw new Error(`KML XML 解析錯誤: ${errorText}。請確保您的 KML 檔案是有效的 XML。`);
                }

                // Temporary layer for parsing GeoJSON. Requires omnivore library loaded.
                const tempOmnivoreLayer = omnivore.kml(kmlDoc);
                if (!tempOmnivoreLayer) {
                    throw new Error("無法從解析的 XML 文檔創建 Omnivore KML 圖層。");
                }
                const geojson = tempOmnivoreLayer.toGeoJSON();
                const parsedFeatures = geojson.features || [];

                console.log(`KML 檔案已解析。找到 ${parsedFeatures.length} 個 features。`);

                if (parsedFeatures.length === 0) {
                    showMessage('KML 載入', 'KML 檔案中沒有找到任何地標 (Point features)。');
                    console.warn("KML 檔案不包含任何可用的 Point 類型 feature。");
                    return;
                }

                const kmlLayersCollectionRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers');
                const kmlLayerDocRef = await kmlLayersCollectionRef.add({
                    name: fileName,
                    uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
                    uploadedBy: auth.currentUser.email || auth.currentUser.uid,
                    uploadedByRole: window.currentUserRole
                });

                const featuresSubCollectionRef = kmlLayersCollectionRef.doc(kmlLayerDocRef.id).collection('features');
                const batch = db.batch();
                let addedCount = 0;
                console.log(`開始批量寫入 ${parsedFeatures.length} 個 features。`);
                for (const f of parsedFeatures) {
                    if (f.geometry && f.properties && f.geometry.type === 'Point') {
                        batch.set(featuresSubCollectionRef.doc(), {
                            geometry: f.geometry,
                            properties: f.properties
                        });
                        addedCount++;
                    } else {
                        console.warn("上傳時跳過非 Point 類型或無座標的 feature:", f.geometry ? f.geometry.type : '無幾何資訊', f);
                    }
                }
                await batch.commit();
                console.log(`批量提交成功。已添加 ${addedCount} 個 features。`);

                showMessage('成功', `KML 檔案 "${fileName}" 已成功上傳並儲存 ${addedCount} 個地標。`);
                hiddenKmlFileInput.value = '';
                selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
                uploadKmlSubmitBtnDashboard.disabled = true;
                updateKmlLayerSelects();
            } catch (error) {
                console.error("處理 KML 檔案或上傳到 Firebase 時出錯:", error);
                showMessage('KML 處理錯誤', `處理 KML 檔案或上傳時發生錯誤：${error.message}`);
            }
        };
        reader.readAsText(file);
    });


    // 事件監聽器：刪除 KML
    deleteSelectedKmlBtn.addEventListener('click', async () => {
        const kmlIdToDelete = kmlLayerSelectDashboard.value;
        if (!kmlIdToDelete) {
            showMessage('提示', '請先選擇要刪除的 KML 圖層。');
            return;
        }
        if (!auth.currentUser || (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor')) {
            showMessage('錯誤', '您沒有權限刪除 KML。');
            return;
        }

        if (!confirm('確定要刪除此 KML 圖層及其所有地標嗎？此操作不可逆！')) {
            return;
        }

        try {
            const kmlLayerDocRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers').doc(kmlIdToDelete);
            const kmlDoc = await kmlLayerDocRef.get();
            if (!kmlDoc.exists) {
                showMessage('錯誤', '找不到該 KML 圖層。');
                return;
            }
            const kmlData = kmlDoc.data();
            const fileName = kmlData.name;

            const featuresSubCollectionRef = kmlLayerDocRef.collection('features');
            const featuresSnapshot = await featuresSubCollectionRef.get();
            const batch = db.batch();
            let deletedFeaturesCount = 0;
            featuresSnapshot.forEach(docRef => {
                batch.delete(docRef.ref);
                deletedFeaturesCount++;
            });
            await batch.commit();
            console.log(`已從子集合中刪除 ${deletedFeaturesCount} 個 features。`);

            await kmlLayerDocRef.delete();
            console.log(`已刪除父 KML 圖層文檔: ${kmlIdToDelete}`);

            showMessage('成功', `KML 圖層 "${fileName}" 已成功刪除，共刪除 ${deletedFeaturesCount} 個地標。`);
            updateKmlLayerSelects();
            window.clearAllKmlLayers();
        }
        catch (error) {
            console.error("刪除 KML 失敗:", error);
            showMessage('刪除失敗', `刪除 KML 圖層時發生錯誤: ${error.message}`);
        }
    });

    // Function to generate the alphanumeric code (3 letters + 5 digits)
    function generateRegistrationAlphanumericCode() {
        let result = '';
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const digits = '0123456789';

        // Generate 3 random letters
        for (let i = 0; i < 3; i++) {
            result += letters.charAt(Math.floor(Math.random() * letters.length));
        }
        // Generate 5 random digits
        for (let i = 0; i < 5; i++) {
            result += digits.charAt(Math.floor(Math.random() * digits.length));
        }
        return result;
    }

    // 事件監聽器：生成一次性註冊碼 (Owner Only)
    generateRegistrationCodeBtn.addEventListener('click', async () => {
        if (window.currentUserRole !== 'owner') {
            showMessage('權限不足', '只有管理員才能生成註冊碼。');
            return;
        }

        if (registrationCodeTimer) {
            clearInterval(registrationCodeTimer);
            registrationCodeTimer = null;
        }

        try {
            const code = generateRegistrationAlphanumericCode();
            let countdownSeconds = 60;
            const expiryDate = new Date();
            expiryDate.setSeconds(expiryDate.getSeconds() + countdownSeconds);

            await db.collection('settings').doc('registration').set({
                oneTimeCode: code,
                oneTimeCodeExpiry: firebase.firestore.Timestamp.fromDate(expiryDate)
            }, { merge: true });

            registrationCodeDisplay.textContent = code;
            registrationCodeCountdown.textContent = ` (剩餘 ${countdownSeconds} 秒)`;
            registrationCodeDisplay.style.display = 'inline-block';
            registrationCodeCountdown.style.display = 'inline-block';
            registrationExpiryDisplay.style.display = 'none';

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
            showMessage('權限不足', '只有管理員才能重新整理用戶列表。');
        }
    });
});