// Mondiro MagicForge - Electron main process.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { initUpdater } = require('./updater');

// The node previews need WebGL2; don't let an old driver blocklist turn it off.
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1200,
    minHeight: 720,
    backgroundColor: '#16171b',
    title: 'Mondiro MagicForge',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  initUpdater(win);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
}

ipcMain.handle('choose-folder', async (_e, current) => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose export folder',
    defaultPath: current || app.getPath('pictures'),
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('write-file', async (_e, folder, name, data) => {
  await fs.promises.mkdir(folder, { recursive: true });
  await fs.promises.writeFile(path.join(folder, path.basename(name)), Buffer.from(data));
  return true;
});

ipcMain.handle('save-graph', async (_e, json, suggested) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Save MagicForge graph',
    defaultPath: suggested,
    filters: [{ name: 'MagicForge Graph', extensions: ['magicforge'] }],
  });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, json, 'utf8');
  return r.filePath;
});

ipcMain.handle('open-graph', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open MagicForge graph',
    filters: [{ name: 'MagicForge Graph', extensions: ['magicforge', 'json'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], text: await fs.promises.readFile(r.filePaths[0], 'utf8') };
});

ipcMain.handle('open-path', (_e, p) => shell.openPath(p));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
