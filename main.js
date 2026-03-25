const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Отключаем аппаратное ускорение если есть проблемы с GPU
// app.disableHardwareAcceleration();

let win;

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
      preload: path.join(__dirname, 'preload.js'),
      // Разрешаем localStorage
      partition: 'persist:smartplan'
    },
    // Иконка приложения
    // icon: path.join(__dirname, 'icon.png')
  });

  win.loadFile('index.html');

  // Убираем стандартное меню — используем своё
  buildMenu();

  // Открывать внешние ссылки в браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // DevTools в dev-режиме
  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools();
  }
}

function buildMenu() {
  const template = [
    {
      label: 'Файл',
      submenu: [
        {
          label: 'Новый проект',
          accelerator: 'CmdOrCtrl+N',
          click: () => win.webContents.executeJavaScript('clearAll && clearAll()')
        },
        { type: 'separator' },
        {
          label: 'Открыть проект...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(win, {
              title: 'Открыть проект SmartPlan',
              filters: [{ name: 'SmartPlan Project', extensions: ['json'] }],
              properties: ['openFile']
            });
            if (!canceled && filePaths[0]) {
              const data = fs.readFileSync(filePaths[0], 'utf8');
              win.webContents.executeJavaScript(
                `applyProjectData(${data}); autoSave && autoSave();`
              );
            }
          }
        },
        {
          label: 'Сохранить проект...',
          accelerator: 'CmdOrCtrl+S',
          click: async () => {
            // Получаем данные из рендерера
            const projectJson = await win.webContents.executeJavaScript(
              'JSON.stringify(getProjectData())'
            );
            const data = JSON.parse(projectJson);
            const defaultName = 'SmartPlan_' + new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
            const { canceled, filePath } = await dialog.showSaveDialog(win, {
              title: 'Сохранить проект SmartPlan',
              defaultPath: defaultName + '.json',
              filters: [{ name: 'SmartPlan Project', extensions: ['json'] }]
            });
            if (!canceled && filePath) {
              fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
            }
          }
        },
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
        {
          label: 'Отменить',
          accelerator: 'CmdOrCtrl+Z',
          click: () => win.webContents.executeJavaScript('undo && undo()')
        },
        { type: 'separator' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        {
          label: 'Тёмная тема',
          click: () => win.webContents.executeJavaScript('if(!G._lightTheme){}else toggleTheme()')
        },
        {
          label: 'Светлая тема',
          click: () => win.webContents.executeJavaScript('if(G._lightTheme){}else toggleTheme()')
        },
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
            message: 'SmartPlan v3',
            detail: 'Инструмент для проектирования и документирования систем умного дома и видеонаблюдения.\n\nРазработано для монтажников и инженеров.'
          })
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
