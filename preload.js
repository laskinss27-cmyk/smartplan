// preload.js — мост между Node.js и renderer
// contextIsolation=true означает что renderer не имеет доступа к Node.js напрямую
// Всё что нужно renderer — пробрасываем через contextBridge

const { contextBridge } = require('electron');

// Renderer может вызывать эти функции через window.electronAPI
contextBridge.exposeInMainWorld('electronAPI', {
  // Сообщаем renderer что мы в Electron
  isElectron: true,
  platform: process.platform
});
