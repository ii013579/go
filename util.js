window.showMessage = (title, msg, cb) => {
    const el = document.getElementById('messageBoxOverlay');
    document.getElementById('messageBoxTitle').textContent = title;
    document.getElementById('messageBoxMessage').textContent = msg;
    el.classList.add('visible');
    document.getElementById('messageBoxCloseBtn').onclick = () => { el.classList.remove('visible'); cb?.(); };
};

window.showMessageCustom = (c) => {
    window.showMessage(c.title, c.message);
    if (c.autoClose) setTimeout(() => document.getElementById('messageBoxOverlay').classList.remove('visible'), c.autoCloseDelay || 3000);
};

window.showRegModal = (cb) => {
    const el = document.getElementById('registrationCodeModalOverlay');
    const msg = document.getElementById('registrationCodeModalMessage');
    let sec = 180;
    el.classList.add('visible');
    const timer = setInterval(() => {
        msg.textContent = `請輸入註冊碼，剩餘時間: ${sec--} 秒`;
        if (sec < 0) { clearInterval(timer); el.classList.remove('visible'); cb(null); }
    }, 1000);
    document.getElementById('confirmRegistrationCodeBtn').onclick = () => {
        clearInterval(timer);
        el.classList.remove('visible');
        cb({ code: document.getElementById('registrationCodeInput').value.trim(), nick: document.getElementById('nicknameInput').value.trim() });
    };
};