// (通用組件模組)
// ui-components.js v2.0
(function () {
    'use strict';
    const $ = id => document.getElementById(id);

    // 1.9.6 訊息框
    window.showMessage = function(title, message, callback) {
        const overlay = $('messageBoxOverlay');
        if (!overlay) return alert(message);
        $('messageBoxTitle').textContent = title;
        $('messageBoxMessage').textContent = message;
        overlay.classList.add('visible');
        const closeBtn = $('messageBoxCloseBtn');
        const closeHandler = () => {
            overlay.classList.remove('visible');
            closeBtn.removeEventListener('click', closeHandler);
            if (callback) callback();
        };
        closeBtn.addEventListener('click', closeHandler);
    };

    // 1.9.6 註冊碼彈窗
    window.showRegistrationCodeModal = function(callback) {
        const modal = $('registrationCodeModalOverlay');
        const msg = $('registrationModalMessage');
        const codeInput = $('registrationCodeInput');
        const nickInput = $('nicknameInput');
        if (!modal) return;

        codeInput.value = ''; nickInput.value = '';
        msg.textContent = '請輸入管理員提供的一次性註冊碼。';
        modal.classList.add('visible');

        let countdown = 60;
        let timer = setInterval(() => {
            msg.textContent = `請輸入管理員提供的一次性註冊碼。剩餘時間: ${countdown} 秒`;
            if (countdown-- <= 0) {
                clearInterval(timer);
                modal.classList.remove('visible');
                callback(null);
            }
        }, 1000);

        $('confirmRegistrationCodeBtn').onclick = () => {
            const code = codeInput.value.trim();
            const nick = nickInput.value.trim();
            if (code && nick) {
                clearInterval(timer);
                modal.classList.remove('visible');
                callback({ code, nickname: nick });
            }
        };
        $('cancelRegistrationCodeBtn').onclick = () => {
            clearInterval(timer);
            modal.classList.remove('visible');
            callback(null);
        };
    };

    // v2.0 確認彈窗組件
    window.UIComponents = {
        showConfirm: (title, msg, onYes) => {
            const modal = $('confirmationModalOverlay');
            if (!modal) return onYes(); // fallback
            $('confirmationModalTitle').textContent = title;
            $('confirmationModalMessage').textContent = msg;
            modal.classList.add('visible');
            $('confirmYesBtn').onclick = () => { modal.classList.remove('visible'); onYes(); };
            $('confirmNoBtn').onclick = () => modal.classList.remove('visible');
        }
    };
})();