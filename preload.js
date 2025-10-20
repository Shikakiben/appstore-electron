const { contextBridge, ipcRenderer } = require('electron');

// Récupère l'argument --de=xxx injecté par main
let desktopEnv = 'generic';
try {
  const arg = process.argv.find(a => a.startsWith('--de='));
  if (arg) desktopEnv = arg.slice(5);
} catch(_) {}

let systemLocale = null;
contextBridge.exposeInMainWorld('electronAPI', {
  amAction: (action, software) => ipcRenderer.invoke('am-action', action, software),
  listAppsDetailed: () => ipcRenderer.invoke('list-apps-detailed'),
  windowControl: (action) => ipcRenderer.invoke('window-control', action),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  desktopEnv: () => desktopEnv,
  systemLocale: () => systemLocale,
  installStart: (name) => ipcRenderer.invoke('install-start', name),
  installCancel: (id) => ipcRenderer.invoke('install-cancel', id, id),
  installSendChoice: (id, choice) => ipcRenderer.invoke('install-send-choice', id, choice),
  onInstallProgress: (cb) => ipcRenderer.on('install-progress', (e, msg) => cb && cb(msg)),
  purgeIconsCache: () => ipcRenderer.invoke('purge-icons-cache'),
  getGpuPref: () => ipcRenderer.invoke('get-gpu-pref'),
  setGpuPref: (val) => ipcRenderer.invoke('set-gpu-pref', val)
});
try {
  const lArg = process.argv.find(a => a.startsWith('--locale='));
  if (lArg) systemLocale = lArg.slice(9);
} catch(_) {}
