const { app, BrowserWindow, BrowserView, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const AdmZip = require('adm-zip');

// Global references
let mainWindow;
let contentView;
let isRetrying = false;
const TITLE_BAR_HEIGHT = 40;
let lastErrorMessage = '';

// Get app directory - handles both packaged and development environments
const getAppDir = () => {
    return process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('userData');
};

// Ensure repository directory exists
function ensureRepoDirExists() {
    const repoDir = path.join(getAppDir(), 'repo');
    try {
        if (!fs.existsSync(repoDir)) {
            fs.mkdirSync(repoDir, { recursive: true });
        }
        return repoDir;
    } catch (e) {
        console.error('Error creating repo directory:', e);
        // Fallback to userData if needed
        const fallbackDir = path.join(app.getPath('userData'), 'repo');
        if (!fs.existsSync(fallbackDir)) {
            fs.mkdirSync(fallbackDir, { recursive: true });
        }
        return fallbackDir;
    }
}

// Create main window and content view
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        frame: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: false
        },
        icon: path.join(__dirname, 'assets/img/logo.png'),
        show: false,
        backgroundColor: '#222222'
    });

    mainWindow.loadFile(path.join(__dirname, 'title-bar.html'));

    contentView = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'content-preload.js'),
            webSecurity: false,
            allowRunningInsecureContent: false,
            partition: 'persist:flamepassneo'
        }
    });

    mainWindow.setBrowserView(contentView);

    // Position content view below title bar
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

    // Show loading page initially
    contentView.webContents.loadFile(path.join(__dirname, 'loading.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Set up IPC event handlers
    setupIpcHandlers();
}

// Set up IPC handlers for window controls and connection
function setupIpcHandlers() {
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
            contentView.webContents.loadFile(path.join(__dirname, 'loading.html'))
                .then(() => {
                    // Send the last error to the loading page
                    if (lastErrorMessage) {
                        contentView.webContents.send('status-update', lastErrorMessage);
                    }
                    return loadContent();
                })
                .catch(error => {
                    console.error('Retry failed:', error);
                    const errorMessage = `Connection failed: ${error.message || error}`;
                    lastErrorMessage = errorMessage;
                    showErrorPage(errorMessage);
                    isRetrying = false;
                });
        }
    });

    // Add handler for error details
    ipcMain.on('get-error-details', (event) => {
        event.returnValue = lastErrorMessage || 'No error details available';
    });

    // Status update channel
    ipcMain.on('get-status-updates', (event) => {
        const statusChannel = 'status-update';
        event.returnValue = statusChannel;

        // If we have a previous error, send it immediately
        if (lastErrorMessage && contentView) {
            setTimeout(() => {
                contentView.webContents.send(statusChannel, lastErrorMessage);
            }, 500);
        } else {
            // Send initial status
            setTimeout(() => {
                contentView.webContents.send(statusChannel, 'Initializing Flamepass Neo...');
            }, 500);

            // Start loading content
            loadContent()
                .catch(error => {
                    console.error('Setup failed:', error);
                    const errorMessage = `Failed: ${error.code || 'unknown'} - ${error.message || error}`;
                    lastErrorMessage = errorMessage;
                    showErrorPage(errorMessage);
                });
        }
    });
}

// Show error page with detailed error message
function showErrorPage(errorMessage) {
    if (contentView && contentView.webContents) {
        contentView.webContents.loadFile(path.join(__dirname, 'error.html'))
            .then(() => {
                // Send the error to the error page
                setTimeout(() => {
                    contentView.webContents.send('error-details', errorMessage);
                }, 500);
            })
            .catch(err => {
                console.error('Failed to load error page:', err);
            });
    }
}
async function downloadRepositoryZip(repoName, branch, targetDir, statusCallback) {
    const initialUrl = `https://github.com/${repoName}/archive/refs/heads/${branch}.zip`;
    const zipPath = path.join(targetDir, 'repo.zip');

    // Ensure target directory exists
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
        function followRedirects(url, redirectCount = 0) {
            if (redirectCount > 5) {
                return reject(new Error('Too many redirects'));
            }

            https.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            }, (response) => {
                // Handle redirects
                if (response.statusCode >= 300 && response.statusCode < 400) {
                    const redirectUrl = response.headers.location;
                    if (!redirectUrl) {
                        return reject(new Error('Redirect without location'));
                    }
                    return followRedirects(redirectUrl, redirectCount + 1);
                }

                // Validate final response
                if (response.statusCode !== 200) {
                    return reject(new Error(`Download failed: ${response.statusCode}`));
                }

                // Create write stream
                const file = fs.createWriteStream(zipPath);
                const totalSize = parseInt(response.headers['content-length'] || '0');
                let downloadedSize = 0;
                let lastUpdate = Date.now();

                // Track download progress
                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    const now = Date.now();

                    if (now - lastUpdate > 250) {
                        const percent = totalSize > 0
                            ? Math.round((downloadedSize / totalSize) * 100)
                            : 0;
                        statusCallback(`Downloading: ${percent}%`);
                        lastUpdate = now;
                    }
                });

                // Pipe download
                response.pipe(file);

                // Handle completion
                file.on('finish', () => {
                    file.close();

                    try {
                        statusCallback('Extracting files...');

                        // Clear existing directory contents
                        fs.readdirSync(targetDir).forEach(item => {
                            if (item !== 'repo.zip') {
                                const fullPath = path.join(targetDir, item);
                                fs.rmSync(fullPath, { recursive: true, force: true });
                            }
                        });

                        // Extract ZIP directly to root, removing top-level directory
                        const { execSync } = require('child_process');
                        execSync(`tar -xf "${zipPath}" -C "${targetDir}" --strip-components=1`);

                        // Remove zip file
                        fs.unlinkSync(zipPath);

                        statusCallback('Download complete');
                        resolve();
                    } catch (extractError) {
                        reject(new Error(`Extraction failed: ${extractError.message}`));
                    }
                });

                // Error handling
                file.on('error', (err) => {
                    file.close();
                    fs.unlinkSync(zipPath);
                    reject(new Error(`File write error: ${err.message}`));
                });
            }).on('error', (err) => {
                reject(new Error(`Download error: ${err.message}`));
            });
        }

        // Start download with redirect handling
        followRedirects(initialUrl);
    });
}
// Fallback manual ZIP extraction (minimal implementation)
function manualZipExtraction(zipPath, extractDir) {
    const fs = require('fs');
    const zlib = require('zlib');
    const crypto = require('crypto');

    // Basic ZIP parsing (simplified)
    const zipBuffer = fs.readFileSync(zipPath);
    const centralDirectorySignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    const centralDirectoryIndex = zipBuffer.indexOf(centralDirectorySignature);

    if (centralDirectoryIndex === -1) {
        throw new Error('Invalid ZIP file');
    }

    // Simple extraction logic
    // Note: This is a very basic implementation and won't handle complex ZIP structures
    const files = [];
    let offset = 0;

    while (offset < centralDirectoryIndex) {
        // Look for local file header signature
        if (zipBuffer.readUInt32LE(offset) === 0x04034b50) {
            const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
            const extraFieldLength = zipBuffer.readUInt16LE(offset + 28);

            const fileName = zipBuffer.slice(offset + 30, offset + 30 + fileNameLength).toString();
            const compressedSize = zipBuffer.readUInt32LE(offset + 18);
            const compressionMethod = zipBuffer.readUInt16LE(offset + 8);

            const dataStart = offset + 30 + fileNameLength + extraFieldLength;
            const fileData = zipBuffer.slice(dataStart, dataStart + compressedSize);

            files.push({ fileName, fileData, compressionMethod });

            offset = dataStart + compressedSize;
        } else {
            break;
        }
    }

    // Extract files
    files.forEach(file => {
        const fullPath = path.join(extractDir, file.fileName);

        // Ensure directory exists
        const directory = path.dirname(fullPath);
        fs.mkdirSync(directory, { recursive: true });

        // Basic decompression (very simplified)
        if (file.compressionMethod === 0) {
            // Stored (no compression)
            fs.writeFileSync(fullPath, file.fileData);
        } else if (file.compressionMethod === 8) {
            // Deflate
            try {
                const decompressed = zlib.inflateRawSync(file.fileData);
                fs.writeFileSync(fullPath, decompressed);
            } catch {
                // Fallback to writing compressed data
                fs.writeFileSync(fullPath, file.fileData);
            }
        }
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

        const timestampData = fs.readFileSync(timestampFile, 'utf8');
        if (!timestampData) {
            return true;
        }

        const lastUpdated = parseInt(timestampData.trim());
        if (isNaN(lastUpdated)) {
            return true;
        }

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

        let needsUpdate = false;
        let indexExists = false;

        try {
            needsUpdate = await shouldUpdate(repoDir);
            indexExists = fs.existsSync(path.join(repoDir, 'index.html'));
        } catch (err) {
            console.error('Error checking update status:', err);
            needsUpdate = true;
            indexExists = false;
        }

        if (needsUpdate || !indexExists) {
            statusCallback('Downloading latest content...');

            try {
                const startTime = Date.now();
                await downloadRepositoryZip(repoName, branch, repoDir, statusCallback);
                const endTime = Date.now();

                statusCallback(`Download complete in ${((endTime - startTime) / 1000).toFixed(1)} seconds!`);
                updateTimestamp(repoDir);
            } catch (err) {
                console.error('Error downloading content:', err);

                // If download fails but we have existing content, use that
                if (fs.existsSync(path.join(repoDir, 'index.html'))) {
                    statusCallback('Download failed. Using existing content...');
                } else {
                    throw new Error(`Download failed: ${err.message}`);
                }
            }
        } else {
            statusCallback('Using existing content...');
        }

        // Verify index.html exists
        const indexPath = path.join(repoDir, 'index.html');
        if (!fs.existsSync(indexPath)) {
            throw new Error('Content files missing or corrupted. No index.html found.');
        }

        // Load the content
        statusCallback('Loading Flamepass Neo app...');

        // Set base URL for relative resources
        contentView.webContents.once('dom-ready', () => {
            contentView.webContents.executeJavaScript(`
                try {
                    const base = document.createElement('base');
                    base.href = 'file://${repoDir.replace(/\\/g, '/')}/';
                    document.head.prepend(base);
                    
                    // Fix any broken images or resources
                    document.querySelectorAll('img[src^="/"]').forEach(img => {
                        img.src = img.src.replace(/^\//, '');
                    });
                    
                    // Fix any broken links
                    document.querySelectorAll('a[href^="/"]').forEach(a => {
                        a.href = a.href.replace(/^\//, '');
                    });
                    
                    // Update any page titles if needed
                    if (document.title.includes('Flamepass')) {
                        document.title = document.title.replace('Flamepass', 'Flamepass Neo');
                    }
                } catch (e) {
                    console.error('Error setting base URL:', e);
                }
            `);
        });

        await contentView.webContents.loadFile(indexPath);
        statusCallback('Flamepass Neo loaded successfully!');

        isRetrying = false;
        return true;
    } catch (error) {
        console.error('Failed to load content:', error);
        const errorMessage = `Failed: ${error.code || 'unknown'} - ${error.message || String(error)}`;
        statusCallback(errorMessage);

        isRetrying = false;
        throw error;
    }
}

// Initialize the app
app.whenReady().then(() => {
    // Register file protocol handler
    protocol.registerFileProtocol('file', (request, callback) => {
        const url = request.url.substr(7); // remove "file://"
        callback(decodeURIComponent(path.normalize(url)));
    });

    createWindow();
});

app.on('window-all-closed', function () {
    app.quit();
});

app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});