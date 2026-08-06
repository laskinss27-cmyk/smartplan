const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const Core = require('./project-core');

const MAX_PROJECT_FILE_BYTES = 20 * 1024 * 1024;
let win;

function assertProjectEnvelope(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 3) {
    throw new Error('Неверный формат проекта SmartPlan');
  }
}

async function openProjectFile(parentWindow) {
  const { canceled, filePaths } = await dialog.showOpenDialog(parentWindow, {
    title: 'Открыть проект SmartPlan',
    filters: [{ name: 'SmartPlan Project', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths[0]) return null;

  const stat = await fs.stat(filePaths[0]);
  if (stat.size > MAX_PROJECT_FILE_BYTES) throw new Error('Файл проекта превышает 20 МБ');
  const data = JSON.parse(await fs.readFile(filePaths[0], 'utf8'));
  Core.validateProjectData(data);
  return data;
}

async function saveProjectFile(parentWindow, data) {
  assertProjectEnvelope(data);
  Core.validateProjectData(data);
  Core.assertProjectIntegrity(data);
  const json = JSON.stringify(data, null, 2);
  if (Buffer.byteLength(json, 'utf8') > MAX_PROJECT_FILE_BYTES) {
    throw new Error('Проект превышает допустимый размер 20 МБ');
  }

  const defaultName = 'SmartPlan_' + new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
  const { canceled, filePath } = await dialog.showSaveDialog(parentWindow, {
    title: 'Сохранить проект SmartPlan',
    defaultPath: defaultName + '.json',
    filters: [{ name: 'SmartPlan Project', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { saved: false };
  await fs.writeFile(filePath, json, 'utf8');
  return { saved: true, filePath };
}

function sendCommand(command) {
  if (win && !win.isDestroyed()) win.webContents.send('smartplan:command', command);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    title: 'SmartPlan',
    backgroundColor: '#07090e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      partition: 'persist:smartplan'
    }
  });

  win.loadFile('index.html');
  buildMenu();

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') shell.openExternal(parsed.toString());
    } catch (_) {
      // Invalid and non-web URLs remain blocked.
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });

  win.webContents.on('context-menu', (event, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const items = [];
    if (params.isEditable) {
      items.push({ label: 'Вырезать', role: 'cut', enabled: params.selectionText.length > 0 });
    }
    items.push({ label: 'Копировать', role: 'copy', enabled: params.selectionText.length > 0 });
    if (params.isEditable) {
      items.push({ label: 'Вставить', role: 'paste' });
      items.push({ type: 'separator' });
      items.push({ label: 'Выделить всё', role: 'selectAll' });
    }
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  if (process.argv.includes('--dev')) win.webContents.openDevTools();
}

function buildMenu() {
  const template = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Новый проект', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('new') },
        { type: 'separator' },
        { label: 'Открыть проект...', accelerator: 'CmdOrCtrl+O', click: () => sendCommand('open') },
        { label: 'Сохранить проект...', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('save') },
        { type: 'separator' },
        {
          label: 'Выход',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', accelerator: 'CmdOrCtrl+Z', click: () => sendCommand('undo') },
        { label: 'Повторить', accelerator: 'CmdOrCtrl+Y', click: () => sendCommand('redo') },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать', accelerator: 'CmdOrCtrl+X' },
        { role: 'copy', label: 'Копировать', accelerator: 'CmdOrCtrl+C' },
        { role: 'paste', label: 'Вставить', accelerator: 'CmdOrCtrl+V' },
        { role: 'selectAll', label: 'Выделить всё', accelerator: 'CmdOrCtrl+A' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Тёмная тема', click: () => sendCommand('theme-dark') },
        { label: 'Светлая тема', click: () => sendCommand('theme-light') },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Сбросить масштаб' },
        { role: 'zoomIn', label: 'Увеличить' },
        { role: 'zoomOut', label: 'Уменьшить' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полный экран' }
      ]
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'О программе',
          click: () => dialog.showMessageBox(win, {
            type: 'info',
            title: 'SmartPlan',
            message: `SmartPlan v${app.getVersion()}`,
            detail: 'Инструмент для проектирования и документирования систем умного дома и видеонаблюдения.\n\nРазработано для монтажников и инженеров.'
          })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('smartplan:open-project', (event) => openProjectFile(BrowserWindow.fromWebContents(event.sender)));
ipcMain.handle('smartplan:save-project', (event, data) => saveProjectFile(BrowserWindow.fromWebContents(event.sender), data));
ipcMain.handle('smartplan:get-version', () => app.getVersion());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
