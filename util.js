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
    if (cfg.autoClose) setTimeout(() => document.getElementById('messageBoxOverlay').classList.remove('visible'), cfg.autoCloseDelay || 3000);
};

window.showRegModal = (callback) => {
    const overlay = document.getElementById('registrationCodeModalOverlay');
    const msg = document.getElementById('registrationCodeModalMessage');
    let countdown = 180;
    overlay.classList.add('visible');
    const timer = setInterval(() => {
        msg.textContent = `請輸入註冊碼，剩餘時間: ${countdown--} 秒`;
        if (countdown < 0) { clearInterval(timer); overlay.classList.remove('visible'); callback(null); }
    }, 1000);
    document.getElementById('confirmRegistrationCodeBtn').onclick = () => {
        const code = document.getElementById('registrationCodeInput').value.trim();
        const nick = document.getElementById('nicknameInput').value.trim();
        if (code && nick) { clearInterval(timer); overlay.classList.remove('visible'); callback({ code, nickname: nick }); }
    };
    document.getElementById('cancelRegistrationCodeBtn').onclick = () => {
        clearInterval(timer); overlay.classList.remove('visible'); callback(null);
    };
};