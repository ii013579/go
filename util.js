window.showMessage = (title, message) => {
    const overlay = document.getElementById('messageBoxOverlay');
    if (!overlay) return;
    document.getElementById('messageBoxTitle').textContent = title;
    document.getElementById('messageBoxMessage').textContent = message;
    overlay.classList.add('visible');
    document.getElementById('messageBoxCloseBtn').onclick = () => overlay.classList.remove('visible');
};