const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

let backend;

function createWindow() {
    // Inicia o backend automaticamente
    backend = spawn("node", [path.join(__dirname, "../backend/server.js")], {
        stdio: 'inherit'
    });

    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        title: "LIMS - Kari Kari",
        icon: path.join(__dirname, "../frontend/assets/img/NovaLogo.png"),
        webPreferences: {
            contextIsolation: true
        }
    });

    // Carrega a URL na porta 3002
    setTimeout(() => {
        win.loadURL("http://localhost:3002/login.html");
    }, 1500);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
    if (backend) backend.kill();
    if (process.platform !== "darwin") app.quit();
});