const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mforge', {
  chooseFolder: (current) => ipcRenderer.invoke('choose-folder', current),
  writeFile: (folder, name, data) => ipcRenderer.invoke('write-file', folder, name, data),
  saveGraph: (json, suggested) => ipcRenderer.invoke('save-graph', json, suggested),
  openGraph: () => ipcRenderer.invoke('open-graph'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  getVersion: () => ipcRenderer.invoke('app-version'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, s) => cb(s)),
});
