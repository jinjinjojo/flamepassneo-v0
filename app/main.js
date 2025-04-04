// Optimized app/main.js

const { app, BrowserWindow, BrowserView, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { promisify } = require('util');
const AdmZip = require('adm-zip');

// Keep a global reference of the window object
let mainWindow;
let contentView;
let isRetrying = false;
const TITLE_BAR_HEIGHT = 40; // Height of custom title bar

// Get the app directory (where the exe is located)
const getAppDir = () => {
    return process.env.PORTABLE_EXECUTABLE_DIR || app.getAppPath();
};

// Create or ensure repo directory exists
function ensureRepoDirExists() {
    try {
        // Use a directory next to the executable
        const repoDir = path.join(getAppDir(), 'repo');
        if (!fs.existsSync(repoDir)) {
            fs.mkdirSync(repoDir, { recursive: true });
        }
        return repoDir;
    } catch (e) {
        console.error('Error creating repo directory:', e);
        // Fallback to userData if we can't write to app directory
        const repoDir = path.join(app.getPath('userData'), 'repo');
        if (!fs.existsSync(repoDir)) {
            fs.mkdirSync(repoDir, { recursive: true });
        }
        return repoDir;
    }
}

// Window creation and setup
function createWindow() {
    // Create the main window with just the title bar
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        frame: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: false // Allow loading local content
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
            preload: path.join(__dirname, 'content-preload.js'),
            webSecurity: false, // Allow loading local content
            allowRunningInsecureContent: false,
            partition: 'persist:flamepass'
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
            loadContent()
                .catch(error => {
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

        // Start loading content
        loadContent(sendUpdate)
            .catch(error => {
                console.error('Setup failed:', error);
                sendUpdate('Connection failed. Please retry. Error: ' + error.message);
            });
    });
}

// Fast download using ZIP archive instead of individual files
async function downloadRepositoryZip(repoName, branch, targetDir, statusCallback) {
    const zipUrl = `https://github.com/${repoName}/archive/${branch}.zip`;
    const zipPath = path.join(targetDir, 'repo.zip');

    statusCallback('Downloading repository archive...');

    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(zipPath);

        https.get(zipUrl, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ZIP: HTTP ${response.statusCode}`));
                return;
            }

            // Track download progress
            const totalSize = parseInt(response.headers['content-length'] || '0');
            let downloadedSize = 0;
            let lastProgressReport = 0;

            response.on('data', (chunk) => {
                downloadedSize += chunk.length;

                // Report progress at most every 250ms
                const now = Date.now();
                if (now - lastProgressReport > 250) {
                    if (totalSize > 0) {
                        const percent = Math.round((downloadedSize / totalSize) * 100);
                        statusCallback(`Downloading: ${percent}% complete...`);
                    } else {
                        statusCallback(`Downloading: ${Math.round(downloadedSize / 1024)} KB...`);
                    }
                    lastProgressReport = now;
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();

                statusCallback('Extracting files...');

                try {
                    // Extract ZIP using adm-zip for speed
                    const zip = new AdmZip(zipPath);

                    // Get the root folder name in the zip
                    const rootFolder = zip.getEntries()[0].entryName.split('/')[0];

                    // Extract everything
                    zip.extractAllTo(targetDir, true);

                    // Move files from subfolder to repo root
                    const extractedPath = path.join(targetDir, rootFolder);
                    const files = fs.readdirSync(extractedPath);

                    for (const file of files) {
                        const srcPath = path.join(extractedPath, file);
                        const destPath = path.join(targetDir, file);

                        // Use rename for moving (faster than copy+delete)
                        if (fs.existsSync(destPath)) {
                            // Remove existing file/directory first
                            if (fs.statSync(destPath).isDirectory()) {
                                fs.rmdirSync(destPath, { recursive: true });
                            } else {
                                fs.unlinkSync(destPath);
                            }
                        }
                        fs.renameSync(srcPath, destPath);
                    }

                    // Clean up
                    fs.rmdirSync(extractedPath, { recursive: true });
                    fs.unlinkSync(zipPath);

                    resolve();
                } catch (err) {
                    reject(err);
                }
            });

            file.on('error', (err) => {
                fs.unlink(zipPath, () => { });
                reject(err);
            });
        }).on('error', (err) => {
            fs.unlink(zipPath, () => { });
            reject(err);
        });
    });
}

// Check if update is needed (once per day)
async function shouldUpdate(targetDir) {
    try {
        const timestampFile = path.join(targetDir, '.last_updated');

        // If the timestamp file doesn't exist or we can't read it, we should update
        if (!fs.existsSync(timestampFile)) {
            return true;
        }

        const lastUpdated = parseInt(fs.readFileSync(timestampFile, 'utf8') || '0');
        const now = Date.now();

        // Check if 24 hours have passed since last update
        return (now - lastUpdated) > (24 * 60 * 60 * 1000);
    } catch (err) {
        console.error('Error checking update timestamp:', err);
        return true; // Update if there's any issue checking
    }
}

// Update the timestamp file
function updateTimestamp(targetDir) {
    try {
        const timestampFile = path.join(targetDir, '.last_updated');
        fs.writeFileSync(timestampFile, Date.now().toString());
    } catch (err) {
        console.error('Error updating timestamp:', err);
    }
}

// Main function to load and display content
async function loadContent(statusCallback = () => { }) {
    try {
        const repoDir = ensureRepoDirExists();
        const repoName = 'jinjinjojo/flamepassapp-static';
        const branch = 'main';

        statusCallback('Checking for content updates...');

        // Check if we need to update the repository
        const needsUpdate = await shouldUpdate(repoDir);

        if (needsUpdate || !fs.existsSync(path.join(repoDir, 'index.html'))) {
            statusCallback('Downloading latest content...');

            try {
                // Fast ZIP download and extraction (much faster than individual files)
                const startTime = Date.now();
                await downloadRepositoryZip(repoName, branch, repoDir, statusCallback);
                const endTime = Date.now();

                statusCallback(`Download complete in ${((endTime - startTime) / 1000).toFixed(1)} seconds!`);
                updateTimestamp(repoDir);
            } catch (err) {
                console.error('Error downloading content:', err);

                // If download fails but we have existing content, use that
                if (fs.existsSync(path.join(repoDir, 'index.html'))) {
                    statusCallback('Using existing content...');
                } else {
                    throw err; // Re-throw if we have no content at all
                }
            }
        } else {
            statusCallback('Using existing content...');
        }

        // Load the content
        statusCallback('Loading Flamepass app...');
        const indexPath = path.join(repoDir, 'index.html');

        // Set base URL for relative resources
        contentView.webContents.once('dom-ready', () => {
            contentView.webContents.executeJavaScript(`
        const base = document.createElement('base');
        base.href = 'file://${repoDir.replace(/\\/g, '/')}/';
        document.head.prepend(base);
      `);
        });

        await contentView.webContents.loadFile(indexPath);

        isRetrying = false;
        return true;
    } catch (error) {
        console.error('Failed to load content:', error);
        statusCallback(`Failed: ${error.code || 'unknown'} - ${error.message || error}`);

        if (contentView && contentView.webContents) {
            contentView.webContents.loadFile(path.join(__dirname, 'error.html'));
        }

        isRetrying = false;
        throw error;
    }
}

// Initialize the app
app.whenReady().then(() => {
    // Register file protocol handler (not strictly needed but adds flexibility)
    protocol.registerFileProtocol('app', (request, callback) => {
        const url = request.url.substr(6); // Remove 'app://'
        callback({ path: path.normalize(`${getAppDir()}/${url}`) });
    });

    createWindow();
});

app.on('window-all-closed', function () {
    app.quit();
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});