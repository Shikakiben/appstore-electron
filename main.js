const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');

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

ipcMain.handle('am-action', async (event, action, software) => {
  let command = '';
  if (action === 'install') {
    command = `appman -i "${software}"`;
  } else if (action === 'uninstall') {
    command = `appman -r "${software}"`;
  }
  return new Promise((resolve) => {
    exec(command, (err, stdout, stderr) => {
      if (err) resolve(stderr || err.message);
      else resolve(stdout);
    });
  });
});

ipcMain.handle('list-apps', async () => {
  return new Promise((resolve) => {
    exec('appman -l', (err, stdout, stderr) => {
      if (err) return resolve([]);
      const apps = stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('◆')) // Garde seulement les lignes commençant par "◆"
        .map(line => {
          // Enlève le "◆", puis récupère le nom avant le premier espace, deux-points ou parenthèse
          // Exemples :
          // ◆ 0ad : ...      --> "0ad"
          // ◆ abiword : ...  --> "abiword"
          // ◆ gimp 3.0.4     --> "gimp"
          let rest = line.slice(1).trim();
          // Si la ligne contient ":", coupe avant
          if (rest.indexOf(':') !== -1) rest = rest.split(':')[0].trim();
          // Prend le premier mot (avant espace) comme nom court (pour les icônes)
          const name = rest.split(' ')[0].trim();
          return name;
        })
        .filter(name => !!name && name.length <= 30); // Optionnel : filtre noms trop longs/vides
      //console.log("Apps envoyées au renderer:", apps);
      resolve(apps);
    });
  });
});
