// js/login.js

// (假設 auth 已經在 firebase-init.js 中初始化並成為全域變數)

// UI 元素
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('loginButton');
const messageDisplayLogin = document.getElementById('messageDisplayLogin'); // 登入頁面的訊息顯示區

// 處理登入按鈕點擊事件
loginButton.addEventListener('click', async () => {
  setLoading('loginButton', 'loadingSpinnerLogin', true); // 使用登入頁面的 spinner
  showMessage('messageDisplayLogin', '', false); // 清除舊訊息

  const email = emailInput.value;
  const password = passwordInput.value;

  if (!email || !password) {
    showMessage('messageDisplayLogin', 'Email 和密碼都必須填寫。');
    setLoading('loginButton', 'loadingSpinnerLogin', false);
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(email, password);
    showMessage('messageDisplayLogin', '登入成功！', false);
    // 登入成功後，導向到主地圖頁面
    setTimeout(() => {
        window.location.href = '地圖 v4.1.0.html';
    }, 1000);
  } catch (error) {
    console.error("登入失敗:", error);
    let errorMessage = '登入失敗，請檢查您的 Email 和密碼。';
    if (error.code) {
      switch (error.code) {
        case 'auth/user-not-found':
          errorMessage = '找不到此 Email 的用戶。';
          break;
        case 'auth/wrong-password':
          errorMessage = '密碼不正確。';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Email 格式不正確。';
          break;
        default:
          errorMessage = `Firebase 錯誤: ${error.message}`;
      }
    } else {
        errorMessage = `未知錯誤: ${error.message}`;
    }
    showMessage('messageDisplayLogin', errorMessage);
  } finally {
    setLoading('loginButton', 'loadingSpinnerLogin', false);
  }
});