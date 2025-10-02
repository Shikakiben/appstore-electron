const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

// Handler pour installer/désinstaller
ipcMain.handle('am-action', async (event, action, software) => {
  const pm = await detectPackageManager();
  if (!pm) return "Aucun gestionnaire 'am' ou 'appman' trouvé sur ce système.";
  let command = '';
  if (action === 'install') {
    command = `${pm} -i "${software}"`;
  } else if (action === 'uninstall') {
    command = `${pm} -R "${software}"`;
  }
  return new Promise((resolve) => {
    exec(command, (err, stdout, stderr) => {
      if (err) resolve(stderr || err.message);
      else resolve(stdout);
    });
  });
});

// Handler pour lister les apps
ipcMain.handle('list-apps', async () => {
  const pm = await detectPackageManager();
  if (!pm) return [];
  const listCmd = `${pm} -l`;
  return new Promise((resolve) => {
    exec(listCmd, (err, stdout, stderr) => {
      if (err) return resolve([]);
      const apps = stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('◆'))
        .map(line => {
          let rest = line.slice(1).trim();
          // Si la ligne contient ":", coupe avant
          if (rest.indexOf(':') !== -1) rest = rest.split(':')[0].trim();
          // Prend le premier mot (avant espace) comme nom court (pour les icônes)
          const name = rest.split(' ')[0].trim();
          return name;
        })
        .filter(name => !!name && name.length <= 30);
      // Tu peux décommenter la ligne ci-dessous pour debugguer
      // console.log("Apps envoyées au renderer:", apps);
      resolve(apps);
    });
  });
});
