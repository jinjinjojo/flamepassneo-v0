const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    retryConnection: () => ipcRenderer.send('retry-connection'),
    getStatusUpdates: () => {
        const channel = ipcRenderer.sendSync('get-status-updates');
        return (callback) => {
            ipcRenderer.on(channel, (_, message) => callback(message));
        };
    }
});