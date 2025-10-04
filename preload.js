const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  amAction: (action, software) => ipcRenderer.invoke('am-action', action, software),
  listAppsDetailed: () => ipcRenderer.invoke('list-apps-detailed'),
  windowControl: (action) => ipcRenderer.invoke('window-control', action)
});
