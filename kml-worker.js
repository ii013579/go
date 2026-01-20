// kml-worker.js v2.1
document.addEventListener('DOMContentLoaded', () => {
    const fileNameDisplay = document.getElementById('selectedKmlFileNameDashboard');
    const hiddenInput = document.getElementById('hiddenKmlFileInput');

    if (fileNameDisplay && hiddenInput) {
        fileNameDisplay.onclick = () => hiddenInput.click();
        hiddenInput.onchange = (e) => {
            fileNameDisplay.textContent = e.target.files[0] ? e.target.files[0].name : "尚未選擇";
        };
    }

    const uploadBtn = document.getElementById('uploadKmlSubmitBtnDashboard');
    if (uploadBtn) {
        uploadBtn.onclick = async () => {
            const file = hiddenInput.files[0];
            if (!file) return window.showMessage("提示", "請選取 KML 檔案");
            // KML 轉 GeoJSON 邏輯...
        };
    }
});