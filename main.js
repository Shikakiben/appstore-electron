const { app, BrowserWindow, ipcMain, Menu, protocol } = require('electron');
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
}

function isExpired(file){
  try {
    const st = fs.statSync(file);
    const age = Date.now() - st.mtimeMs;
    return age > ICON_TTL_MS;
  } catch(_) { return true; }
}

function downloadIconToCache(fileName){
  return new Promise((resolve) => {
    ensureIconCacheSetup();
    const dest = path.join(iconsCacheDir, fileName);
    const url = `https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/${fileName}`;
    const file = fs.createWriteStream(dest + '.tmp');
    const timer = setTimeout(()=> { try { file.close(); fs.unlinkSync(dest + '.tmp'); } catch(_){} resolve(null); }, 15000);
    https.get(url, (res) => {
      if (res.statusCode !== 200) { clearTimeout(timer); try { file.close(); fs.unlinkSync(dest + '.tmp'); } catch(_){} return resolve(null); }
      res.pipe(file);
      file.on('finish', () => {
        clearTimeout(timer);
        file.close(()=>{
          try {
            const stat = fs.statSync(dest + '.tmp');
            if (stat.size < 200) { fs.unlinkSync(dest + '.tmp'); return resolve(null); }
            fs.renameSync(dest + '.tmp', dest);
            resolve(dest);
          } catch(_) { try { fs.unlinkSync(dest + '.tmp'); } catch(__){} resolve(null); }
        });
      });
    }).on('error', () => {
      clearTimeout(timer);
      try { file.close(); fs.unlinkSync(dest + '.tmp'); } catch(_){}
      resolve(null);
    });
  });
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
  // Préparer une icône (svg) simple si absente
  // fs déjà importé en haut
  const iconPath = path.join(__dirname, 'app-icon.svg');
  if (!fs.existsSync(iconPath)) {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><circle cx='32' cy='32' r='28' fill='#3584e4'/><text x='32' y='38' font-size='22' text-anchor='middle' fill='white' font-family='Arial,Helvetica,sans-serif'>AM</text></svg>";
    try { fs.writeFileSync(iconPath, svg, 'utf8'); } catch(_){}
  }
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
      additionalArguments: [ `--de=${deTag}` ]
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

  let command;
  if (action === 'install') command = `${pm} -i "${software}"`;
  else if (action === 'uninstall') command = `${pm} -R "${software}"`;
  else return `Action inconnue: ${action}`;

  return new Promise((resolve) => {
    exec(command, (err, stdout, stderr) => {
      if (err) return resolve(stderr || stdout || err.message || 'Erreur');
      resolve(stdout || '');
    });
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
