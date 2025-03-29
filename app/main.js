const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const childProcess = require('child_process');
const fs = require('fs');
const ProxyManager = require('./proxy-manager');

// Keep a global reference of the window object
let mainWindow;
let serverProcess;
const PORT = 8080;
let proxyManager;

// Create necessary directories if they don't exist
function ensureDirsExist() {
    const dirs = ['sessions', 'cache-js'];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

function createWindow() {
    // Create the browser window - borderless
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        frame: false, // Borderless window
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, '../build/icon.png')
    });

    // Hide until proxy is ready
    mainWindow.hide();

    // Set up event handlers for the IPC
    ipcMain.on('minimize-window', () => {
        mainWindow.minimize();
    });

    ipcMain.on('maximize-window', () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    });

    ipcMain.on('close-window', () => {
        mainWindow.close();
    });
}

async function startServer() {
    const serverPath = path.join(__dirname, '../src/server.js');

    serverProcess = childProcess.fork(serverPath, [], {
        env: {
            ...process.env,
            PORT: PORT.toString(),
            NODE_PATH: path.join(__dirname, '..')
        },
        cwd: path.join(__dirname, '..')
    });

    serverProcess.on('error', (error) => {
        console.error('Server error:', error);
    });

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Initialize proxy manager
    proxyManager = new ProxyManager(`http://localhost:${PORT}`);

    // Create a session and load app.flamepass.com
    try {
        const sessionId = await proxyManager.createSession();
        const targetUrl = "https://app.flamepass.com";
        const proxyUrl = `http://localhost:${PORT}/${sessionId}/${targetUrl}`;

        // Now load the URL in our window
        mainWindow.loadURL(proxyUrl);
        mainWindow.show();
    } catch (error) {
        console.error('Failed to set up proxy:', error);
        // If proxy setup fails, show a basic page
        mainWindow.loadFile(path.join(__dirname, 'error.html'));
        mainWindow.show();
    }
}

function stopServer() {
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
    }
}

app.on('ready', () => {
    ensureDirsExist();
    createWindow();
    startServer();
});

app.on('window-all-closed', function () {
    stopServer();
    app.quit();
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
        startServer();
    }
});