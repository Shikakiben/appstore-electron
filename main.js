const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');

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

function createWindow () {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    frame: false, // barre de titre personnalisée (header)
    title: ' ',
    backgroundColor: '#f6f8fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });

  // Supprimer la barre de menu par défaut (File, Edit, View, etc.)
  try { Menu.setApplicationMenu(null); } catch(_) {}
  // Cacher la barre au cas où certaines plateformes la garderaient
  win.setMenuBarVisibility(false);

  win.loadFile('index.html');
  // Forcer un titre vide après chargement (certains WM réévaluent après loadFile)
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

app.whenReady().then(createWindow);


// (Handlers de mise à jour avancée retirés)

// Action générique: install / uninstall / opérations spéciales update
ipcMain.handle('am-action', async (_event, action, software) => {
  const pm = await detectPackageManager();
  if (!pm) return "Aucun gestionnaire 'am' ou 'appman' trouvé";

  let command = null;
  if (action === 'install') command = `${pm} -i "${software}"`;
  else if (action === 'uninstall') command = `${pm} -R "${software}"`;
  else if (action === '__update_all__') {
    // Utiliser spawn pour éviter un blocage potentiel et pouvoir retourner la sortie complète.
    return new Promise((resolve) => {
      const child = spawn(pm, ['-u']);
      let stdoutBuf = '';
      let stderrBuf = '';
      const killTimer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch(_){}
      }, 5 * 60 * 1000); // 5 minutes sécurité
      child.stdout.on('data', d => { stdoutBuf += d.toString(); });
      child.stderr.on('data', d => { stderrBuf += d.toString(); });
      child.on('close', (code) => {
        clearTimeout(killTimer);
        if (code === 0) return resolve(stdoutBuf || '');
        resolve(stderrBuf || stdoutBuf || `Processus terminé avec code ${code}`);
      });
      child.on('error', (err) => {
        clearTimeout(killTimer);
        resolve(err.message || 'Erreur inconnue');
      });
    });
  }
  else return `Action inconnue: ${action}`;

  return new Promise((resolve) => {
    exec(command, (err, stdout, stderr) => {
      if (err) return resolve(stderr || err.message || 'Erreur');
      resolve(stdout || '');
    });
  });
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


// (Handler de streaming de mise à jour supprimé – désormais on utilise am-action '__update_all__')
