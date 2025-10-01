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
      if (err) resolve([]);
      else {
        const apps = stdout.split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0);
        resolve(apps);
      }
    });
  });
});
