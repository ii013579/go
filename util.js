window.showMessage = (title, message, callback) => {
    const overlay = document.getElementById('messageBoxOverlay');
    document.getElementById('messageBoxTitle').textContent = title;
    document.getElementById('messageBoxMessage').textContent = message;
    overlay.classList.add('visible');
    document.getElementById('messageBoxCloseBtn').onclick = () => {
        overlay.classList.remove('visible');
        if (callback) callback();
    };
};

window.showMessageCustom = (cfg) => {
    window.showMessage(cfg.title, cfg.message);
    if (cfg.autoClose) {
        setTimeout(() => document.getElementById('messageBoxOverlay').classList.remove('visible'), cfg.autoCloseDelay || 3000);
    }
};

window.showRegModal = (callback) => {
    const overlay = document.getElementById('registrationCodeModalOverlay');
    const msg = document.getElementById('registrationCodeModalMessage');
    const codeIn = document.getElementById('registrationCodeInput');
    const nickIn = document.getElementById('nicknameInput');
    let countdown = 180;
    overlay.classList.add('visible');

    const timer = setInterval(() => {
        msg.textContent = `請輸入註冊碼，剩餘時間: ${countdown--} 秒`;
        if (countdown < 0) {
            clearInterval(timer); overlay.classList.remove('visible'); callback(null);
        }
    }, 1000);

    document.getElementById('confirmRegistrationCodeBtn').onclick = () => {
        if (codeIn.value && nickIn.value) {
            clearInterval(timer); overlay.classList.remove('visible');
            callback({ code: codeIn.value.trim(), nickname: nickIn.value.trim() });
        }
    };
    document.getElementById('cancelRegistrationCodeBtn').onclick = () => {
        clearInterval(timer); overlay.classList.remove('visible'); callback(null);
    };
};