// js/register.js

// (假設 auth 和 db 已經在 firebase-init.js 中初始化並成為全域變數)

// UI 元素
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const userNameInput = document.getElementById('userName');
const registrationCodeInput = document.getElementById('registrationCode');
const registerButton = document.getElementById('registerButton');
const messageDisplayRegister = document.getElementById('messageDisplayRegister'); // 註冊頁面的訊息顯示區

// Firestore 中的設定文檔參考 (用於檢查註冊碼)
const settingsDocRef = db.collection('settings').doc('registration');

// 處理「註冊」按鈕點擊事件
registerButton.addEventListener('click', async () => {
  setLoading('registerButton', 'loadingSpinnerRegister', true); // 使用註冊頁面的 spinner
  showMessage('messageDisplayRegister', '', false); // 清除舊訊息

  const email = emailInput.value;
  const password = passwordInput.value;
  const userName = userNameInput.value;
  const registrationCode = registrationCodeInput.value.toUpperCase();

  if (!email || !password || !userName || !registrationCode) {
    showMessage('messageDisplayRegister', '所有欄位都必須填寫。');
    setLoading('registerButton', 'loadingSpinnerRegister', false);
    return;
  }

  if (password.length < 6) {
    showMessage('messageDisplayRegister', '密碼至少需要 6 個字元。');
    setLoading('registerButton', 'loadingSpinnerRegister', false);
    return;
  }

  try {
    // 1. 檢查註冊碼是否有效 (從 Firestore 讀取，規則允許任何已認證用戶讀取 settings)
    const registrationSettings = await settingsDocRef.get();
    if (!registrationSettings.exists || !registrationSettings.data().isRegistrationOpen) {
      showMessage('messageDisplayRegister', '目前註冊已關閉。');
      setLoading('registerButton', 'loadingSpinnerRegister', false);
      return;
    }

    const storedCode = registrationSettings.data().registrationCode;
    const expiresAt = registrationSettings.data().expiresAt ? registrationSettings.data().expiresAt.toDate() : null;

    if (registrationCode !== storedCode) {
      showMessage('messageDisplayRegister', '註冊碼不正確。');
      setLoading('registerButton', 'loadingSpinnerRegister', false);
      return;
    }
    if (!expiresAt || expiresAt < new Date()) {
      showMessage('messageDisplayRegister', '註冊碼已過期。');
      setLoading('registerButton', 'loadingSpinnerRegister', false);
      return;
    }

    // 2. 執行 Firebase Authentication 註冊
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);
    const user = userCredential.user;
    console.log("Firebase Auth 註冊成功:", user.uid);

    // 3. 向 Firestore 寫入初始用戶資料 (遵循 v4.0.40 規則：不包含 role)
    // 此寫入會被 Firestore 規則檢查，確保沒有 'role' 字段
    await db.collection('users').doc(user.uid).set({
      email: user.email,
      name: userName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
      // 【重要】這裡絕對不能包含 role: 'editor' 或任何 role 字段
    });
    console.log("Firestore 初始用戶資料寫入成功 (無角色)。");

    showMessage('messageDisplayRegister', '帳號建立成功！您的角色需要管理員手動賦予。', false);
    // 成功後導向登入頁面，或者直接導向主頁
    setTimeout(() => {
        window.location.href = '登入 v4.1.0.html'; // 導向登入頁
    }, 2000);


  } catch (error) {
    console.error("註冊失敗:", error);
    let errorMessage = '註冊失敗，請稍後再試。';
    if (error.code) {
      switch (error.code) {
        case 'auth/email-already-in-use':
          errorMessage = '此 Email 已被使用。';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Email 格式不正確。';
          break;
        case 'auth/weak-password':
          errorMessage = '密碼強度不足，請至少輸入 6 個字元。';
          break;
        case 'permission-denied': // Firestore 權限錯誤
          errorMessage = '權限不足。請檢查您的 Firestore 規則或聯絡管理員。';
          break;
        default:
          errorMessage = `Firebase 錯誤: ${error.message}`;
      }
    } else {
        errorMessage = `未知錯誤: ${error.message}`;
    }
    showMessage('messageDisplayRegister', errorMessage);
  } finally {
    setLoading('registerButton', 'loadingSpinnerRegister', false);
  }
});