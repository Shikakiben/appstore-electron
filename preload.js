const { contextBridge, ipcRenderer } = require('electron');

// Récupère l'argument --de=xxx injecté par main
let desktopEnv = 'generic';
try {
  const arg = process.argv.find(a => a.startsWith('--de='));
  if (arg) desktopEnv = arg.slice(5);
} catch(_) {}

contextBridge.exposeInMainWorld('electronAPI', {
  amAction: (action, software) => ipcRenderer.invoke('am-action', action, software),
  listAppsDetailed: () => ipcRenderer.invoke('list-apps-detailed'),
  windowControl: (action) => ipcRenderer.invoke('window-control', action),
  desktopEnv: () => desktopEnv,
  installStart: (name) => ipcRenderer.invoke('install-start', name),
  installCancel: (id) => ipcRenderer.invoke('install-cancel', id),
  onInstallProgress: (cb) => ipcRenderer.on('install-progress', (e, msg) => cb && cb(msg)),
  purgeIconsCache: () => ipcRenderer.invoke('purge-icons-cache')
});
