// Auto-update from GitHub Releases (installed builds only).
const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_EVERY_MS = 2 * 60 * 60 * 1000;

function initUpdater(win) {
  const send = (status) => {
    if (!win.isDestroyed()) win.webContents.send('update-status', status);
  };

  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('update-check', () => check(true));
  ipcMain.handle('update-install', () => autoUpdater.quitAndInstall(true, true));

  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => send({ state: 'latest' }));
  autoUpdater.on('update-available', (info) => send({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => send({ state: 'error', message: String(err?.message || err).split('\n')[0] }));

  let busy = false;
  async function check(manual) {
    if (!app.isPackaged) return { state: 'dev' };
    if (busy) return null;
    busy = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      if (manual) send({ state: 'error', message: String(e?.message || e).split('\n')[0] });
    } finally {
      busy = false;
    }
    return null;
  }

  win.webContents.once('did-finish-load', () => setTimeout(() => check(false), 3000));
  setInterval(() => check(false), CHECK_EVERY_MS);
}

module.exports = { initUpdater };
