const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),
    retryConnection: () => ipcRenderer.send('retry-connection'),
    getStatusUpdates: () => {
        const channel = ipcRenderer.sendSync('get-status-updates');
        return (callback) => {
            ipcRenderer.on(channel, (_, message) => callback(message));
        };
    }
});