const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const ProxyManager = require('./proxy-manager');

// Keep a global reference of the window object
let mainWindow;
let contentView;
let serverProcess;
const PORT = 8080;
let proxyManager;
let isRetrying = false;
const TITLE_BAR_HEIGHT = 40; // Height of our custom title bar

// Create necessary directories if they don't exist
function ensureDirsExist() {
    const dirs = ['sessions', 'cache-js'];
    dirs.forEach(dir => {
        const dirPath = path.join(__dirname, '..', dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    });
}

function createWindow() {
    // Create the main window with just the title bar
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        frame: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'assets/img/logo.png'),
        show: false,
        backgroundColor: '#222222'
    });

    // Load the title bar HTML
    mainWindow.loadFile(path.join(__dirname, 'title-bar.html'));

    // Create the content view for everything else
    contentView = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'content-preload.js')
        }
    });

    mainWindow.setBrowserView(contentView);

    // Position the content view below the title bar
    function resizeContentView() {
        const bounds = mainWindow.getBounds();
        contentView.setBounds({
            x: 0,
            y: TITLE_BAR_HEIGHT,
            width: bounds.width,
            height: bounds.height - TITLE_BAR_HEIGHT
        });
    }

    resizeContentView();
    mainWindow.on('resize', resizeContentView);

    // Initially load the loading page
    contentView.webContents.loadFile(path.join(__dirname, 'loading.html'));

    // Show window when content is ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

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

    ipcMain.on('retry-connection', () => {
        if (!isRetrying) {
            isRetrying = true;
            contentView.webContents.loadFile(path.join(__dirname, 'loading.html'));
            startServer().catch(error => {
                console.error('Retry failed:', error);
                contentView.webContents.loadFile(path.join(__dirname, 'error.html'));
                isRetrying = false;
            });
        }
    });

    // Add status update channel
    ipcMain.on('get-status-updates', (event) => {
        const statusChannel = 'status-update';

        const sendUpdate = (message) => {
            try {
                if (contentView && contentView.webContents) {
                    contentView.webContents.send(statusChannel, message);
                }
            } catch (e) {
                console.error('Error sending status update:', e);
            }
        };

        // Send initial status
        sendUpdate('Initializing Flamepass...');

        // Return the channel name so renderer can listen
        event.returnValue = statusChannel;

        // Start the server setup process
        buildRammerhead()
            .then(() => {
                sendUpdate('Starting proxy server...');
                return startServer(sendUpdate);
            })
            .catch(error => {
                console.error('Setup failed:', error);
                sendUpdate('Connection failed. Please retry.');
            });
    });
}

// Helper function to check if server is ready
async function waitForServerReady(port) {
    const maxAttempts = 30;
    const delay = 500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(`http://localhost:${port}/needpassword`, (res) => {
                    if (res.statusCode === 200) {
                        resolve();
                    } else {
                        reject(new Error(`Server returned status code ${res.statusCode}`));
                    }
                });

                req.on('error', reject);
                req.setTimeout(delay, () => reject(new Error('Request timeout')));
            });

            console.log('Server is ready!');
            return;
        } catch (error) {
            console.log(`Waiting for server (attempt ${attempt + 1}/${maxAttempts})...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw new Error('Server failed to start in a reasonable time');
}

async function buildRammerhead() {
    return new Promise((resolve, reject) => {
        const buildProcess = childProcess.spawn('node', [path.join(__dirname, '../src/build.js')], {
            cwd: path.join(__dirname, '..')
        });

        buildProcess.stdout.on('data', (data) => {
            console.log(`Build output: ${data}`);
        });

        buildProcess.stderr.on('data', (data) => {
            console.error(`Build error: ${data}`);
        });

        buildProcess.on('close', (code) => {
            if (code === 0) {
                console.log('Rammerhead build successful');
                resolve();
            } else {
                console.error(`Rammerhead build failed with code ${code}`);
                reject(new Error(`Build process exited with code ${code}`));
            }
        });

        buildProcess.on('error', (error) => {
            console.error('Failed to start build process:', error);
            reject(error);
        });
    });
}

async function startServer(statusCallback = () => { }) {
    try {
        // Ensure directories exist
        ensureDirsExist();

        // Kill any existing server process
        if (serverProcess) {
            serverProcess.kill();
            serverProcess = null;
        }

        // Start server with proper environment
        statusCallback('Launching proxy server...');
        serverProcess = childProcess.fork(path.join(__dirname, '../src/server.js'), [], {
            env: {
                ...process.env,
                PORT: PORT.toString(),
                NODE_PATH: path.join(__dirname, '..')
            },
            cwd: path.join(__dirname, '..')
        });

        // Handle server errors
        serverProcess.on('error', (error) => {
            console.error('Server error:', error);
            statusCallback('Server error occurred.');
            if (contentView && contentView.webContents) {
                contentView.webContents.loadFile(path.join(__dirname, 'error.html'));
            }
        });

        // Wait for server to be ready
        statusCallback('Waiting for server to initialize...');
        await waitForServerReady(PORT);

        // Initialize proxy manager
        statusCallback('Creating secure session...');
        proxyManager = new ProxyManager(`http://localhost:${PORT}`);

        // Create a session with password
        const sessionId = await proxyManager.createSession('sharkie4life');

        // Enable shuffling for better obfuscation
        statusCallback('Setting up secure connection...');
        await proxyManager.editSession(sessionId, '', true);

        const targetUrl = "https://app.flamepass.com";
        const proxyUrl = `http://localhost:${PORT}/${sessionId}/${targetUrl}`;

        // Now load the URL in our content view
        statusCallback('Connecting to Flamepass...');
        await contentView.webContents.loadURL(proxyUrl);

        isRetrying = false;
        return true;
    } catch (error) {
        console.error('Failed to set up proxy:', error);
        if (contentView && contentView.webContents) {
            contentView.webContents.loadFile(path.join(__dirname, 'error.html'));
        }
        isRetrying = false;
        throw error;
    }
}

function stopServer() {
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
    }
}

app.on('ready', () => {
    createWindow();
});

app.on('window-all-closed', function () {
    stopServer();
    app.quit();
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});