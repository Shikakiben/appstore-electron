function getIconUrl(app) {
  return `https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/${app}.png`;
}

const appsDiv = document.getElementById('apps');
const resultDiv = document.getElementById('result');

(async () => {
  const softwares = await window.electronAPI.listApps();

  for(const name of softwares) {
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img src="${getIconUrl(name)}" alt="${label}" onerror="this.src='https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/blank.png'">
      <div>${label}</div>
      <button onclick="amAction('install','${name}')">Installer</button>
      <button onclick="amAction('uninstall','${name}')">Désinstaller</button>
    `;
    appsDiv.appendChild(card);
  }
})();

window.amAction = async (action, name) => {
  resultDiv.textContent = `Exécution de ${action} pour ${name}...`;
  const res = await window.electronAPI.amAction(action, name);
  resultDiv.textContent = res;
};
