const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  openProject: () => ipcRenderer.invoke('smartplan:open-project'),
  saveProject: (data) => ipcRenderer.invoke('smartplan:save-project', data),
  getVersion: () => ipcRenderer.invoke('smartplan:get-version'),
  onCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('smartplan:command', listener);
    return () => ipcRenderer.removeListener('smartplan:command', listener);
  }
});
