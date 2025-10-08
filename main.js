const { app, BrowserWindow, ipcMain, Menu, protocol, shell } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
// Fonction pour détecter le gestionnaire dispo
const detectPackageManager = () => {
  return new Promise((resolve) => {
    exec('command -v am', (err) => {
      if (!err) return resolve('am');
      exec('command -v appman', (err2) => {
        if (!err2) return resolve('appman');
        resolve(null); // aucun trouvé
      });
    });
  });
};

// -- Cache icônes via protocole personnalisé appicon:// --
let iconsCacheDir = null;
let blankIconPath = null;
const ICON_TTL_MS = 7 * 24 * 3600 * 1000; // 7 jours
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB max cache size

// In-flight downloads deduplication map: fileName -> Promise<string|null>
const inFlightDownloads = new Map();
let iconsMeta = null; // lazy-loaded index { [fileName]: { etag, lastModified, size, mtime } }
let iconsMetaPath = null;

function ensureIconCacheSetup(){
  if (!iconsCacheDir) {
    iconsCacheDir = path.join(app.getPath('userData'), 'icons-cache');
    try { fs.mkdirSync(iconsCacheDir, { recursive: true }); } catch(_){}
  }
  if (!blankIconPath) {
    blankIconPath = path.join(iconsCacheDir, '__blank.png');
    if (!fs.existsSync(blankIconPath)) {
      // Créer une petite image PNG 1x1 transparente (base64)
      const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGP4BwQACfsD/QiP3O4AAAAASUVORK5CYII=','base64');
      try { fs.writeFileSync(blankIconPath, png1x1); } catch(_){ }
    }
  }
  if (!iconsMetaPath) iconsMetaPath = path.join(iconsCacheDir, 'index.json');
  // lazy load index
  if (iconsMeta === null) {
    try {
      if (fs.existsSync(iconsMetaPath)) {
        const raw = fs.readFileSync(iconsMetaPath, 'utf8');
        iconsMeta = JSON.parse(raw || '{}');
      } else iconsMeta = {};
    } catch(_) { iconsMeta = {}; }
  }
}

function saveIconsMeta() {
  try {
    if (!iconsMetaPath) return;
    fs.writeFileSync(iconsMetaPath + '.tmp', JSON.stringify(iconsMeta || {}, null, 2));
    fs.renameSync(iconsMetaPath + '.tmp', iconsMetaPath);
  } catch(_) {}
}

function pruneCache() {
  try {
    ensureIconCacheSetup();
    const files = fs.readdirSync(iconsCacheDir).filter(f => f.endsWith('.png') && f !== path.basename(blankIconPath));
    let total = 0;
    const infos = [];
    for (const f of files) {
      try {
        const p = path.join(iconsCacheDir, f);
        const st = fs.statSync(p);
        total += st.size;
        infos.push({ file: f, path: p, size: st.size, mtime: st.mtimeMs });
      } catch(_){}
    }
    if (total <= MAX_CACHE_SIZE_BYTES) return;
    infos.sort((a,b)=> a.mtime - b.mtime); // oldest first
    for (const info of infos) {
      try { fs.unlinkSync(info.path); total -= info.size; if (iconsMeta && iconsMeta[info.file]) delete iconsMeta[info.file]; } catch(_){}
      if (total <= MAX_CACHE_SIZE_BYTES) break;
    }
    saveIconsMeta();
  } catch(_) {}
}

function isExpired(file){
  try {
    const st = fs.statSync(file);
    const age = Date.now() - st.mtimeMs;
    return age > ICON_TTL_MS;
  } catch(_) { return true; }
}

function downloadIconToCache(fileName){
  ensureIconCacheSetup();
  const dest = path.join(iconsCacheDir, fileName);
  // Deduplicate concurrent downloads
  if (inFlightDownloads.has(fileName)) return inFlightDownloads.get(fileName);

  const p = new Promise((resolve) => {
    // Quick cache hit if exists and fresh
    try {
      const st = fs.statSync(dest);
      if (st.size > 200 && !isExpired(dest)) {
        // update meta and return
        if (!iconsMeta) iconsMeta = {};
        iconsMeta[fileName] = iconsMeta[fileName] || {};
        iconsMeta[fileName].size = st.size;
        iconsMeta[fileName].mtime = Date.now();
        saveIconsMeta();
        return resolve(dest);
      }
    } catch(_){ }

    // prepare logging
    const logPath = path.join(iconsCacheDir, 'download.log');
    const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
    const MAX_LOG_BACKUPS = 3;
    function rotateLogIfNeeded(){
      try {
        if (!fs.existsSync(logPath)) return;
        const st = fs.statSync(logPath);
        if (st.size <= MAX_LOG_SIZE) return;
        // rotate: download.log.2 -> download.log.3, etc.
        for (let i = MAX_LOG_BACKUPS - 1; i >= 0; i--) {
          const src = i === 0 ? logPath : `${logPath}.${i}`;
          const dst = `${logPath}.${i+1}`;
          if (fs.existsSync(src)) {
            try { fs.renameSync(src, dst); } catch(_){}
          }
        }
      } catch(_){}
    }
    function appendLog(msg){
      try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`); } catch(_){}
      try { rotateLogIfNeeded(); } catch(_){}
    }

    // Prepare conditional headers from stored metadata
    const meta = iconsMeta && iconsMeta[fileName];
    const baseUrl = `https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/${fileName}`;
    const headersBase = {};
    if (meta) {
      if (meta.etag) headersBase['If-None-Match'] = meta.etag;
      if (meta.lastModified) headersBase['If-Modified-Since'] = meta.lastModified;
    }

    // retry logic
    const maxAttempts = 3;
    let attempt = 0;

    function tryDownload(){
      attempt++;
      appendLog(`Attempt ${attempt} for ${fileName}`);
      const headers = Object.assign({}, headersBase);
      const req = https.request(baseUrl, { method: 'GET', headers, timeout: 15000 }, (res) => {
        if (res.statusCode === 304) {
          appendLog(`${fileName} not modified (304)`);
          try { fs.utimesSync(dest, new Date(), new Date()); } catch(_){ }
          iconsMeta = iconsMeta || {};
          iconsMeta[fileName] = iconsMeta[fileName] || {};
          iconsMeta[fileName].mtime = Date.now();
          saveIconsMeta();
          return resolve(dest);
        }
        if (res.statusCode !== 200) {
          appendLog(`${fileName} HTTP ${res.statusCode}`);
          return onFail(`http ${res.statusCode}`);
        }

        const tmpPath = dest + '.tmp';
        const file = fs.createWriteStream(tmpPath);
        let finished = false;
        res.pipe(file);
        file.on('finish', () => {
          try {
            const stat = fs.statSync(tmpPath);
            if (stat.size < 200) { try { fs.unlinkSync(tmpPath); } catch(_){} appendLog(`${fileName} too small after download`); return onFail('too-small'); }
            fs.renameSync(tmpPath, dest);
            const newMeta = { size: stat.size, mtime: Date.now() };
            if (res.headers && res.headers['etag']) newMeta.etag = res.headers['etag'];
            if (res.headers && res.headers['last-modified']) newMeta.lastModified = res.headers['last-modified'];
            iconsMeta = iconsMeta || {};
            iconsMeta[fileName] = newMeta;
            saveIconsMeta();
            pruneCache();
            finished = true;
            appendLog(`${fileName} downloaded OK (${stat.size} bytes)`);
            return resolve(dest);
          } catch(e) {
            try { fs.unlinkSync(tmpPath); } catch(_){}
            appendLog(`${fileName} write error: ${e && e.message}`);
            return onFail(e && e.message);
          }
        });
        file.on('error', (e) => { try { fs.unlinkSync(tmpPath); } catch(_){} if (!finished) { appendLog(`${fileName} stream error: ${e && e.message}`); onFail(e && e.message); } });
      });
      req.on('timeout', () => { try { req.abort(); } catch(_){} appendLog(`${fileName} timeout`); onFail('timeout'); });
      req.on('error', (err) => { appendLog(`${fileName} request error: ${err && err.message}`); onFail(err && err.message); });
      req.end();
    }

    function onFail(reason){
      if (attempt < maxAttempts) {
        const delay = 300 * Math.pow(2, attempt-1);
        appendLog(`${fileName} will retry in ${delay}ms (reason: ${reason})`);
        setTimeout(tryDownload, delay);
      } else {
        appendLog(`${fileName} failed after ${attempt} attempts (reason: ${reason})`);
        // record lastError in iconsMeta for diagnostics
        iconsMeta = iconsMeta || {};
        iconsMeta[fileName] = iconsMeta[fileName] || {};
        iconsMeta[fileName].lastError = String(reason);
        iconsMeta[fileName].mtime = Date.now();
        saveIconsMeta();
        return resolve(null);
      }
    }

    // start first attempt
    tryDownload();
  });

  inFlightDownloads.set(fileName, p);
  // cleanup inFlight map after completion
  p.then(() => inFlightDownloads.delete(fileName), () => inFlightDownloads.delete(fileName));
  return p;
}

function registerIconProtocol(){
  ensureIconCacheSetup();
  protocol.registerFileProtocol('appicon', (request, callback) => {
    try {
      // Formats acceptés: appicon://name ou appicon://name.png
      let urlPath = request.url.replace(/^appicon:\/\//i, '');
      if (!urlPath) return callback(blankIconPath);
      // Sécuriser (retirer éventuels ../)
      urlPath = urlPath.replace(/\?.*$/, '').replace(/#.*/, '');
      urlPath = path.basename(urlPath); // garde seulement le fichier
      if (!/\.png$/i.test(urlPath)) urlPath += '.png';
      const localPath = path.join(iconsCacheDir, urlPath);
      // Vérifier en cache
      try {
        const st = fs.statSync(localPath);
        if (st.size > 200 && !isExpired(localPath)) return callback(localPath);
      } catch(_){}
      // Télécharger sinon
      downloadIconToCache(urlPath).then(result => {
        if (result) return callback(result);
        callback(blankIconPath);
      });
    } catch(_) {
      callback(blankIconPath);
    }
  });
}

function createWindow () {
  // Détection simple de l'environnement de bureau pour stylage léger
  function detectDesktopEnv() {
    const env = process.env;
    const xdg = (env.XDG_CURRENT_DESKTOP || '').toLowerCase();
    const session = (env.DESKTOP_SESSION || '').toLowerCase();
    if (xdg.includes('gnome') || session.includes('gnome')) return 'gnome';
    if (xdg.includes('kde') || xdg.includes('plasma') || session.includes('plasma') || session.includes('kde')) return 'plasma';
    if (xdg.includes('xfce') || session.includes('xfce')) return 'xfce';
    if (xdg.includes('cinnamon') || session.includes('cinnamon')) return 'cinnamon';
    if (xdg.includes('unity') || session.includes('unity')) return 'unity';
    return 'generic';
  }
  const deTag = detectDesktopEnv();
  const sysLocale = (app.getLocale && typeof app.getLocale === 'function') ? app.getLocale() : (process.env.LANG || 'en');
  // Icône PNG
  const iconPath = path.join(__dirname, 'app-icon.png');
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    frame: false, // retour à la barre personnalisée
    title: ' ',
    icon: iconPath,
    backgroundColor: '#f6f8fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      additionalArguments: [ `--de=${deTag}`, `--locale=${sysLocale}` ]
    }
  });

  // Supprimer la barre de menu par défaut (File, Edit, View, etc.)
  try { Menu.setApplicationMenu(null); } catch(_) {}
  // Cacher la barre au cas où certaines plateformes la garderaient
  win.setMenuBarVisibility(false);

  win.loadFile('index.html');
  // Forcer un titre vide après affichage (on affiche le faux header)
  win.once('ready-to-show', () => {
    try { win.setTitle(' '); } catch(_) {}
  });

  // Raccourci clavier manuel pour ouvrir DevTools (menu supprimé)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key && input.key.toLowerCase() === 'i') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // Menu contextuel (clic droit) basique pour copier / coller
  win.webContents.on('context-menu', (event, params) => {
    const { selectionText, isEditable } = params;
    const hasSelection = selectionText && selectionText.trim().length > 0;
    const template = [];

    if (isEditable) {
      template.push(
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'delete', label: 'Supprimer' },
        { type: 'separator' },
        { role: 'selectAll', label: 'Tout sélectionner' }
      );
    } else if (hasSelection) {
      template.push(
        { role: 'copy', label: 'Copier' },
        { type: 'separator' },
        { role: 'selectAll', label: 'Tout sélectionner' }
      );
    } else {
      // Conserver une option sélectionner tout même sans sélection
      template.push({ role: 'selectAll', label: 'Tout sélectionner' });
    }

    template.push({ type: 'separator' }, { role: 'toggleDevTools', label: 'Outils de développement' });
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win });
  });
}

app.whenReady().then(() => {
  try { registerIconProtocol(); } catch(e) { console.warn('Protocole appicon échec:', e); }
  createWindow();
});

// IPC: purge complète du cache d'icônes
ipcMain.handle('purge-icons-cache', async () => {
  ensureIconCacheSetup();
  let removed = 0;
  try {
    const files = fs.readdirSync(iconsCacheDir).filter(f => f.endsWith('.png') && f !== path.basename(blankIconPath));
    for (const f of files) {
      try { fs.unlinkSync(path.join(iconsCacheDir, f)); removed++; } catch(_){}
    }
  } catch(_){}
  return { removed };
});

// Ouvrir une URL dans le navigateur externe
ipcMain.handle('open-external', async (_event, url) => {
  try {
    // validation basique
    if (!url || typeof url !== 'string') return { ok: false, error: 'invalid url' };
    // Autoriser seulement http/https
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'scheme not allowed' };
    await shell.openExternal(url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});


// Action générique: install / uninstall / update (simple)
ipcMain.handle('am-action', async (_event, action, software) => {
  const pm = await detectPackageManager();
  if (!pm) return "Aucun gestionnaire 'am' ou 'appman' trouvé";

  if (action === '__update_all__') {
    return new Promise((resolve) => {
      const child = spawn(pm, ['-u']);
      let stdoutBuf = '';
      let stderrBuf = '';
      const killTimer = setTimeout(() => { try { child.kill('SIGTERM'); } catch(_){} }, 5*60*1000);
      child.stdout.on('data', d => { stdoutBuf += d.toString(); });
      child.stderr.on('data', d => { stderrBuf += d.toString(); });
      child.on('close', (code) => {
        clearTimeout(killTimer);
        if (code === 0) return resolve(stdoutBuf || '');
        resolve(stderrBuf || stdoutBuf || `Processus terminé avec code ${code}`);
      });
      child.on('error', (err) => { clearTimeout(killTimer); resolve(err.message || 'Erreur inconnue'); });
    });
  }

  // Use spawn to avoid shell interpolation / injection risks
  let args;
  if (action === 'install') args = ['-i', software];
  else if (action === 'uninstall') args = ['-R', software];
  else return `Action inconnue: ${action}`;

  return new Promise((resolve) => {
    try {
      const child = spawn(pm, args);
      let stdoutBuf = '';
      let stderrBuf = '';
      const killTimer = setTimeout(() => { try { child.kill('SIGTERM'); } catch(_){} }, 5*60*1000);
      child.stdout.on('data', d => { stdoutBuf += d.toString(); });
      child.stderr.on('data', d => { stderrBuf += d.toString(); });
      child.on('close', (code) => {
        clearTimeout(killTimer);
        if (code === 0) return resolve(stdoutBuf || '');
        resolve(stderrBuf || stdoutBuf || `Processus terminé avec code ${code}`);
      });
      child.on('error', (err) => { clearTimeout(killTimer); resolve(err.message || 'Erreur processus'); });
    } catch (e) {
      return resolve(e && e.message ? e.message : String(e));
    }
  });
});

// --- Installation streaming (Étapes 1 & 2) ---
// Fournit un suivi ligne à ligne pour l'installation d'un paquet.
// Retourne { id } immédiatement, puis envoie des événements 'install-progress'
// { id, kind:'start', name }
// { id, kind:'line', line }
// { id, kind:'done', code, success, duration, output }
// { id, kind:'error', message }
// Pas d'annulation encore (peut être ajoutée plus tard).
const activeInstalls = new Map();
ipcMain.handle('install-start', async (event, name) => {
  const pm = await detectPackageManager();
  if (!pm) return { error: "Aucun gestionnaire 'am' ou 'appman' trouvé" };
  if (!name || typeof name !== 'string') return { error: 'Nom invalide' };
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8);
  let output = '';
  const startedAt = Date.now();
  let stdoutRemainder = '';
  let stderrRemainder = '';
  const child = spawn(pm, ['-i', name]);
  activeInstalls.set(id, child);
  const wc = event.sender;
  const send = (payload) => { try { wc.send('install-progress', Object.assign({ id }, payload)); } catch(_) {} };
  send({ kind:'start', name });
  const killTimer = setTimeout(() => { try { child.kill('SIGTERM'); } catch(_){} }, 10*60*1000); // 10 min sécurité
  function flushLines(chunk, isErr){
    const txt = chunk.toString();
    output += txt;
    let buffer = (isErr ? stderrRemainder : stdoutRemainder) + txt;
    const lines = buffer.split(/\r?\n/);
    if (lines.length > 1) {
      // conserver la dernière partielle
      if (isErr) stderrRemainder = lines.pop(); else stdoutRemainder = lines.pop();
      for (const l of lines) {
        const line = l.trim();
        if (!line) continue;
        send({ kind:'line', line, stream: isErr ? 'stderr' : 'stdout' });
      }
    } else {
      if (isErr) stderrRemainder = lines[0]; else stdoutRemainder = lines[0];
    }
  }
  child.stdout.on('data', d => flushLines(d, false));
  child.stderr.on('data', d => flushLines(d, true));
  child.on('error', (err) => {
    clearTimeout(killTimer);
    send({ kind:'error', message: err.message || 'Erreur processus' });
  });
  child.on('close', (code) => {
    clearTimeout(killTimer);
    // Émettre éventuelles dernières lignes partielles
    if (stdoutRemainder.trim()) send({ kind:'line', line: stdoutRemainder.trim(), stream:'stdout' });
    if (stderrRemainder.trim()) send({ kind:'line', line: stderrRemainder.trim(), stream:'stderr' });
  activeInstalls.delete(id);
    const duration = Date.now() - startedAt;
    const success = code === 0;
    send({ kind:'done', code, success, duration, output });
  });
  return { id };
});

// Annulation forcée d'une installation en cours
ipcMain.handle('install-cancel', async (event, installId) => {
  if (!installId) return { ok:false, error:'ID manquant' };
  const child = activeInstalls.get(installId);
  if (!child) return { ok:false, error:'Processus introuvable' };
  try {
    // Annulation immédiate demandée: SIGKILL (destruction directe)
    // NOTE: Pas de nettoyage applicatif dans l'outil am/appman si transaction partielle.
    child.kill('SIGKILL');
    // Émettre un événement immédiat de type 'cancelled' (le close suivra quand le process aura réellement quitté)
    try { event.sender.send('install-progress', { id: installId, kind:'cancelled' }); } catch(_){ }
    return { ok:true };
  } catch(e){
    return { ok:false, error: e.message || 'Annulation échouée' };
  }
});


// Liste détaillée: distingue installées vs catalogue
ipcMain.handle('list-apps-detailed', async () => {
  const pm = await detectPackageManager();
  if (!pm) {
    return { installed: [], all: [], pmFound: false, error: "Aucun gestionnaire 'am' ou 'appman' détecté dans le PATH." };
  }
  const listCmd = `${pm} -l`;
  return new Promise((resolve) => {
    exec(listCmd, (err, stdout) => {
      if (err || !stdout) return resolve({ installed: [], all: [], pmFound: true, error: 'Échec exécution commande liste.' });
      const lines = stdout.split('\n');
      let inInstalled = false;
      let inCatalog = false;
      const installedSet = new Set();
      const catalogSet = new Set();

      // Maps pour descriptions
      const catalogDesc = new Map();
      const installedDesc = new Map();

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('YOU HAVE INSTALLED')) { inInstalled = true; continue; }
        if (line.startsWith('To list all installable programs')) { inInstalled = false; continue; }
        if (line.startsWith('LIST OF')) { inCatalog = true; continue; }
        if (!line.startsWith('\u25c6')) continue;

        const rest = line.slice(1).trim();
        const colonIdx = rest.indexOf(':');
        let desc = null;
        let left = rest;
        if (colonIdx !== -1) {
            left = rest.slice(0, colonIdx).trim();
            desc = rest.slice(colonIdx + 1).trim();
            if (desc === '') desc = null;
        }
        if (inInstalled && !inCatalog) {
          const name = left.split(/\s+/)[0].trim();
          if (name) {
            installedSet.add(name);
            if (desc) installedDesc.set(name, desc);
          }
        } else if (inCatalog) {
          const name = left.split(/\s+/)[0].trim();
          if (name) {
            catalogSet.add(name);
            if (desc) catalogDesc.set(name, desc);
          }
        }
      }

      const allSet = new Set([...catalogSet, ...installedSet]);
      const all = Array.from(allSet).map(name => ({
        name,
        installed: installedSet.has(name),
        desc: catalogDesc.get(name) || installedDesc.get(name) || null
      }));
      const installed = Array.from(installedSet).map(name => ({
        name,
        installed: true,
        desc: catalogDesc.get(name) || installedDesc.get(name) || null
      }));
      resolve({ installed, all, pmFound: true });
    });
  });
});

// Contrôles de fenêtre pour le mode frameless
ipcMain.handle('window-control', (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  switch(action){
    case 'min': win.minimize(); break;
    case 'max': win.isMaximized() ? win.unmaximize() : win.maximize(); break;
    case 'close': win.close(); break;
  }
});


// Fin fichier main.js simplifié

// (Intégration terminal / streaming supprimée)
