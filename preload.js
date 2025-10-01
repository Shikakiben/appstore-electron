const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  amAction: (action, software) => ipcRenderer.invoke('am-action', action, software),
  listApps: () => ipcRenderer.invoke('list-apps')
});
