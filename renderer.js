function getIconUrl(app) {
  return `https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/${app}.png`;
}

// --- Gestion barre de titre personnalisée (boutons fenêtre & hauteur) ---
(function initWindowBar(){
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.win-btn');
    if (!b) return;
    const act = b.getAttribute('data-action');
    if (act) window.electronAPI.windowControl(act);
  });
  const applyHeaderHeight = () => {
    const header = document.querySelector('.app-header');
    if (!header) return;
    document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
  };
  window.addEventListener('resize', applyHeaderHeight);
  window.addEventListener('DOMContentLoaded', applyHeaderHeight);
  if (document.readyState !== 'loading') applyHeaderHeight();
  // Forcer un léger délai pour aligner scroll-shell après styles
  setTimeout(applyHeaderHeight, 50);
  // Gestion globale des erreurs pour debug visuel
  window.addEventListener('error', (ev) => {
    try {
      const t = document.getElementById('toast');
      if (t) { t.hidden = false; t.textContent = 'Erreur: ' + ev.message; setTimeout(()=>{ t.hidden = true; }, 5000); }
      // log console complet
      // eslint-disable-next-line no-console
      console.error('Erreur globale', ev.error || ev.message);
    } catch(_){}
  });
  window.addEventListener('unhandledrejection', (ev) => {
    try {
      const t = document.getElementById('toast');
      if (t) { t.hidden = false; t.textContent = 'Promesse rejetée: ' + (ev.reason?.message || ev.reason); setTimeout(()=>{ t.hidden = true; }, 6000); }
      // eslint-disable-next-line no-console
      console.error('Rejet non géré', ev.reason);
    } catch(_){}
  });
})();

const modeButtons = document.querySelectorAll('.view-mode-switch .mode-btn');
const state = {
  allApps: [], // [{name, installed}]
  filtered: [],
  activeCategory: 'all',
  viewMode: localStorage.getItem('viewMode') || 'grid'
};

// --- (Ré)ajout gestion changement de mode d'affichage ---
function applyActiveModeButton() {
  modeButtons.forEach(btn => {
    const m = btn.getAttribute('data-mode');
    const isActive = m === state.viewMode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

modeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.getAttribute('data-mode');
    if (!mode || mode === state.viewMode) return;
    // Sécuriser valeur
    if (!['grid','list','icons','cards'].includes(mode)) return;
    state.viewMode = mode;
    localStorage.setItem('viewMode', state.viewMode);
    applyActiveModeButton();
    // Re-rendu avec la liste filtrée actuelle
    render(state.filtered);
  });
});

// Appliquer état initial (ex: si localStorage != grid)
applyActiveModeButton();

const appsDiv = document.getElementById('apps');

// --- Références DOM rétablies après nettoyage catégories ---
const appDetailsSection = document.getElementById('appDetails');
const backToListBtn = document.getElementById('backToListBtn');
const detailsIcon = document.getElementById('detailsIcon');
const detailsName = document.getElementById('detailsName');
const detailsLong = document.getElementById('detailsLong');
const detailsInstallBtn = document.getElementById('detailsInstallBtn');
const detailsUninstallBtn = document.getElementById('detailsUninstallBtn');
const detailsGallery = document.getElementById('detailsGallery');
const detailsGalleryInner = document.getElementById('detailsGalleryInner');
const resultDiv = document.getElementById('result');
const toast = document.getElementById('toast');
const searchInput = document.getElementById('searchInput');
const refreshBtn = document.getElementById('refreshBtn');
const tabs = document.querySelectorAll('.tab');
// Mise à jour
const updatesPanel = document.getElementById('updatesPanel');
const runUpdatesBtn = document.getElementById('runUpdatesBtn');
const updateSpinner = document.getElementById('updateSpinner');
const updateResult = document.getElementById('updateResult');
const updateFinalMessage = document.getElementById('updateFinalMessage');
const updatedAppsIcons = document.getElementById('updatedAppsIcons');
const installedCountEl = document.getElementById('installedCount');
const resultWrapper = document.getElementById('resultWrapper');
const resultExpandBtn = document.getElementById('resultExpandBtn');
const resultCopyBtn = document.getElementById('resultCopyBtn');
const resultClearBtn = document.getElementById('resultClearBtn');
// Lightbox
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxCaption = document.getElementById('lightboxCaption');
const lightboxPrev = document.getElementById('lightboxPrev');
const lightboxNext = document.getElementById('lightboxNext');
const lightboxClose = document.getElementById('lightboxClose');
let lightboxState = { images: [], index: 0, originApp: null };

// Cache descriptions (réinstallé)
const descriptionCache = new Map();

function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(()=> { if (toast) toast.hidden = true; }, 2300);
}

async function loadApps() {
  appsDiv?.setAttribute('aria-busy','true');
  let detailed;
  try {
    detailed = await window.electronAPI.listAppsDetailed();
  } catch (e) {
    detailed = { all: [], installed: [], error: 'IPC échec: ' + (e?.message || e) };
  }
  if (!detailed.pmFound) {
    state.allApps = [];
    state.filtered = [];
    if (appsDiv) {
      appsDiv.innerHTML = `<div class="empty-state"><h3>Aucun gestionnaire détecté</h3><p style='font-size:13px;line-height:1.4;max-width:520px;'>Installez <code>AM</code> ou <code>appman</code> (dans le PATH). Sans cela le catalogue ne peut pas être affiché.</p></div>`;
    }
    if (installedCountEl) installedCountEl.textContent = '0';
    appsDiv?.setAttribute('aria-busy','false');
    return;
  }
  if (detailed.error) {
    state.allApps = [];
    state.filtered = [];
    if (appsDiv) appsDiv.innerHTML = `<div class='empty-state'><h3>Erreur de récupération</h3><p style='font-size:13px;'>${detailed.error}</p></div>`;
    if (installedCountEl) installedCountEl.textContent = '0';
    appsDiv?.setAttribute('aria-busy','false');
    return;
  }
  state.allApps = detailed.all || [];
  state.filtered = state.allApps;
  if (installedCountEl) installedCountEl.textContent = String((detailed.installed || []).length);
  render(state.filtered);
}

function render(list) {
  document.body.classList.remove('view-list','view-icons','view-grid','view-cards');
  if (state.viewMode === 'list') document.body.classList.add('view-list');
  else if (state.viewMode === 'icons') document.body.classList.add('view-icons');
  else if (state.viewMode === 'cards') document.body.classList.add('view-cards');
  else document.body.classList.add('view-grid');
  appsDiv?.setAttribute('aria-busy', 'true');
  if (appsDiv) appsDiv.innerHTML = '';
  list.forEach(item => {
    const { name, installed, desc } = typeof item === 'string' ? { name: item, installed: false, desc: null } : item;
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    const tile = document.createElement('div');
    tile.className = 'app-tile';
    tile.setAttribute('data-app', name);
    let shortDesc = desc || (installed ? 'Application installée.' : 'Disponible pour installation.');
    if (shortDesc.length > 110) shortDesc = shortDesc.slice(0,107).trim() + '…';
    let actionsHTML = '';
    if (state.viewMode === 'list') {
      if (!installed) {
        actionsHTML = `<div class="actions"><button class="inline-action install" data-action="install" data-app="${name}">Installer</button></div>`;
      } else {
        actionsHTML = `<div class="actions"><button class="inline-action uninstall" data-action="uninstall" data-app="${name}">Désinstaller</button></div>`;
      }
    }
    if (state.viewMode === 'cards') {
      tile.innerHTML = `
        <img src="${getIconUrl(name)}" alt="${label}" onerror="this.src='https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/blank.png'">
        <div class="tile-text">
          <div class="tile-name">${label} ${installed ? '<span class="installed-badge">Installée</span>' : ''}</div>
          <div class="tile-short">${shortDesc}</div>
        </div>
      `;
    } else {
      tile.innerHTML = `
        <img src="${getIconUrl(name)}" alt="${label}" onerror="this.src='https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/blank.png'">
        <div class="tile-text">
          <div class="tile-name">${label} ${installed ? '<span class=\"installed-badge\">Installée</span>' : ''}</div>
          <div class="tile-short">${shortDesc}</div>
        </div>
        ${actionsHTML}
      `;
    }
    appsDiv?.appendChild(tile);
  });
  appsDiv?.setAttribute('aria-busy', 'false');
}

function showDetails(appName) {
  const app = state.allApps.find(a => a.name === appName);
  if (!app) return;
  const label = app.name.charAt(0).toUpperCase() + app.name.slice(1);
  if (detailsIcon) {
    detailsIcon.src = getIconUrl(app.name);
    detailsIcon.onerror = () => { detailsIcon.src = 'https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/blank.png'; };
  }
  if (detailsName) {
    detailsName.textContent = app.installed ? `${label} ✓` : label;
  }
  if (detailsLong) detailsLong.textContent = 'Récupération distante en cours...\n\nNom interne: ' + app.name;
  if (detailsGallery) { detailsGallery.hidden = true; }
  if (detailsGalleryInner) { detailsGalleryInner.innerHTML = ''; }
  if (detailsInstallBtn) {
    detailsInstallBtn.hidden = app.installed;
    detailsInstallBtn.disabled = false;
    detailsInstallBtn.setAttribute('data-name', app.name);
    detailsInstallBtn.classList.add('btn-primary');
  }
  if (detailsUninstallBtn) {
    detailsUninstallBtn.hidden = !app.installed;
    detailsUninstallBtn.disabled = false;
    detailsUninstallBtn.setAttribute('data-name', app.name);
    if (!detailsUninstallBtn.hidden) {
      detailsUninstallBtn.classList.remove('btn-outline');
      detailsUninstallBtn.classList.add('btn-primary');
    } else {
      detailsUninstallBtn.classList.remove('btn-primary');
      detailsUninstallBtn.classList.add('btn-outline');
    }
  }
  if (appDetailsSection) appDetailsSection.hidden = false;
  document.body.classList.add('details-mode');
  if (appsDiv) appsDiv.hidden = true;
  loadRemoteDescription(app.name).catch(err => {
    if (detailsLong) detailsLong.textContent = 'Impossible de récupérer la description distante.\n' + (err?.message || err || 'Erreur inconnue');
  });
}

backToListBtn?.addEventListener('click', () => {
  if (appDetailsSection) appDetailsSection.hidden = true;
  document.body.classList.remove('details-mode');
  if (appsDiv) appsDiv.hidden = false;
});

function applySearch() {
  const q = (searchInput?.value || '').toLowerCase().trim();
  let base = state.allApps;
  if (state.activeCategory === 'updates') {
    render([]);
    return;
  }
  if (state.activeCategory === 'installed') {
    base = state.allApps.filter(a => a.installed);
  }
  state.filtered = !q ? base : base.filter(a => a.name.toLowerCase().includes(q));
  render(state.filtered);
}

appsDiv?.addEventListener('click', (e) => {
  const actionBtn = e.target.closest('.inline-action');
  if (actionBtn) {
    e.stopPropagation();
    const action = actionBtn.getAttribute('data-action');
    const appName = actionBtn.getAttribute('data-app');
    if (!action || !appName) return;
    if (action === 'install') {
      actionBtn.disabled = true;
      showToast('Installation de ' + appName + '…');
      window.electronAPI.amAction('install', appName).then(res => {
        if (resultDiv) { resultDiv.hidden = false; if (resultWrapper) resultWrapper.hidden = false; resultDiv.textContent = res; }
        loadApps().then(()=> applySearch());
      });
    } else if (action === 'uninstall') {
      if (!window.confirm('Désinstaller ' + appName + ' ?')) return;
      actionBtn.disabled = true;
      showToast('Désinstallation de ' + appName + '…');
      window.electronAPI.amAction('uninstall', appName).then(res => {
        if (resultDiv) { resultDiv.hidden = false; if (resultWrapper) resultWrapper.hidden = false; resultDiv.textContent = res; }
        loadApps().then(()=> applySearch());
      });
    }
    return;
  }
  const tile = e.target.closest('.app-tile');
  if (!tile) return;
  const name = tile.getAttribute('data-app');
  if (!name) return;
  showDetails(name);
});

detailsInstallBtn?.addEventListener('click', async () => {
  const name = detailsInstallBtn.getAttribute('data-name');
  if (!name) return;
  showToast('Installation de ' + name + '…');
  if (resultDiv) { resultDiv.hidden = false; if (resultWrapper) resultWrapper.hidden = false; resultDiv.textContent = 'Installation de ' + name + '...'; }
  detailsInstallBtn.disabled = true;
  const res = await window.electronAPI.amAction('install', name);
  if (resultDiv) resultDiv.textContent = res;
  await loadApps();
  showDetails(name);
});

detailsUninstallBtn?.addEventListener('click', async () => {
  const name = detailsUninstallBtn.getAttribute('data-name');
  if (!name) return;
  const ok = window.confirm('Désinstaller ' + name + ' ?');
  if (!ok) return;
  showToast('Désinstallation de ' + name + '…');
  if (resultDiv) { resultDiv.hidden = false; if (resultWrapper) resultWrapper.hidden = false; resultDiv.textContent = 'Désinstallation de ' + name + '...'; }
  detailsUninstallBtn.disabled = true;
  const res = await window.electronAPI.amAction('uninstall', name);
  if (resultDiv) resultDiv.textContent = res;
  await loadApps();
  showDetails(name);
});

searchInput?.addEventListener('input', applySearch);
refreshBtn?.addEventListener('click', async () => {
  showToast('Rafraîchissement de la liste…');
  await loadApps();
  applySearch();
});

(async () => {
  await loadApps();
  // Assurer spinner et résultats cachés au démarrage
  if (updateSpinner) updateSpinner.hidden = true;
  if (updateResult) updateResult.style.display = 'none';
  // Forcer la vue liste au démarrage
  if (appDetailsSection) appDetailsSection.hidden = true;
  document.body.classList.remove('details-mode');
  if (appsDiv) appsDiv.hidden = false;
})();

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.activeCategory = tab.getAttribute('data-category') || 'all';
    applySearch();
    const isUpdates = state.activeCategory === 'updates';
    if (updatesPanel) updatesPanel.hidden = !isUpdates;
    if (!isUpdates) {
      // Quand on quitte l'onglet, on cache le spinner si resté affiché
      if (updateSpinner) updateSpinner.hidden = true;
    } else {
      // Quand on entre dans l'onglet, si aucune mise à jour en cours on s'assure que spinner caché
      if (runUpdatesBtn && !runUpdatesBtn.disabled && updateSpinner) updateSpinner.hidden = true;
    }
    // Si on change d'onglet alors qu'on est en mode détaillé, retourner à la liste
    if (document.body.classList.contains('details-mode')) {
      document.body.classList.remove('details-mode');
      if (appDetailsSection) appDetailsSection.hidden = true;
      if (appsDiv) appsDiv.hidden = false;
    }
  });
});

// Sortie avec ESC
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('details-mode')) {
    if (appDetailsSection) appDetailsSection.hidden = true;
    document.body.classList.remove('details-mode');
    if (appsDiv) appsDiv.hidden = false;
  }
});

// Bouton Mettre à jour: exécution simple sans progression détaillée
runUpdatesBtn?.addEventListener('click', async () => {
  showToast('Mises à jour en cours…');
  if (runUpdatesBtn) runUpdatesBtn.disabled = true;
  if (updateSpinner) {
    // Reset complet spinner
    updateSpinner.hidden = false;
  }
  if (updateResult) updateResult.style.display = 'none';
  if (updateFinalMessage) updateFinalMessage.textContent = '';
  if (updatedAppsIcons) updatedAppsIcons.innerHTML = '';
  let res;
  let safetyTimer;
  safetyTimer = setTimeout(() => {
    if (updateSpinner && !updateSpinner.hidden) {
      updateSpinner.hidden = true;
      if (updateFinalMessage) updateFinalMessage.textContent = 'Temps dépassé ou sortie incomplète.';
      if (updateResult) updateResult.style.display = 'block';
      if (runUpdatesBtn) runUpdatesBtn.disabled = false;
    }
  }, 180000); // 3 minutes de sécurité
  try {
    res = await window.electronAPI.amAction('__update_all__');
  } catch (e) {
    res = 'Erreur: ' + (e?.message || e);
  }
  clearTimeout(safetyTimer);
  if (updateSpinner) updateSpinner.hidden = true;
  if (runUpdatesBtn) runUpdatesBtn.disabled = false;
  showToast('Mises à jour terminées');
  await loadApps();
  applySearch();
  // Analyse de la sortie pour déterminer quelles apps ont été mises à jour
  const updated = new Set();
  if (typeof res === 'string') {
    const lines = res.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      // Exemple supposé: "✔ appname is updated" ou "appname updated" selon le gestionnaire
      // 1) On capture d'abord la forme avec symbole ✔
      let m = line.match(/^✔\s+([A-Za-z0-9._-]+)/);
      // 2) Sinon on tente une forme générique "name updated"
      if (!m) m = line.match(/^([A-Za-z0-9._-]+)\s+updated/i);
      if (m && m[1]) {
        // Ignorer les lignes indiquant juste que l'app EST déjà à jour ("is updated")
        if (/\bis updated\b/i.test(line)) continue;
        // Certaines lignes "Nothing to do here" ne doivent rien ajouter
        if (/Nothing to do here/i.test(line)) continue;
        updated.add(m[1].toLowerCase());
      }
    }
    // Si la sortie indique explicitement qu'il n'y avait rien à faire, on annule toute détection
    if (/Nothing to do here!/i.test(res)) {
      updated.clear();
    }
  }

  if (updateResult) updateResult.style.display = 'block';
  if (updated.size > 0) {
    if (updateFinalMessage) updateFinalMessage.textContent = 'Applications mises à jour :';
    if (updatedAppsIcons) {
      updatedAppsIcons.innerHTML = '';
      updated.forEach(name => {
        const img = document.createElement('img');
        img.src = getIconUrl(name);
        img.alt = name;
        img.onerror = () => { img.src = 'https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/blank.png'; };
        updatedAppsIcons.appendChild(img);
      });
    }
  } else {
    if (updateFinalMessage) updateFinalMessage.textContent = 'Aucune mise à jour nécessaire.';
    if (updatedAppsIcons) updatedAppsIcons.innerHTML = '';
  }
  if (resultDiv) {
    const wasAtBottom = (() => {
      if (!resultDiv || resultDiv.hidden) return true;
      return (resultDiv.scrollTop + resultDiv.clientHeight) >= (resultDiv.scrollHeight - 8);
    })();
    resultDiv.hidden = false;
    if (resultWrapper) resultWrapper.hidden = false;
    resultDiv.textContent = (res && res.trim()) ? res : 'Terminé';
    if (wasAtBottom) {
      resultDiv.scrollTop = resultDiv.scrollHeight;
    }
  }
});

// Actions console
resultExpandBtn?.addEventListener('click', () => {
  if (!resultDiv) return;
  resultDiv.classList.toggle('expanded');
});
resultCopyBtn?.addEventListener('click', async () => {
  if (!resultDiv) return;
  try { await navigator.clipboard.writeText(resultDiv.textContent || ''); showToast('Copié'); } catch(_) { showToast('Impossible de copier'); }
});
resultClearBtn?.addEventListener('click', () => {
  if (resultDiv) resultDiv.textContent = '';
});

// (Descriptions externes retirées)
async function loadRemoteDescription(appName) {
  // Si dans le cache (<24h) on réutilise
  const cached = descriptionCache.get(appName);
  if (cached && (Date.now() - cached.timestamp) < 24*3600*1000) {
    applyDescription(appName, cached);
    return;
  }
  const url = `https://portable-linux-apps.github.io/apps/${encodeURIComponent(appName)}.html`;
  let html;
  try {
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    html = await resp.text();
  } catch (e) {
    throw new Error('Échec fetch: ' + (e.message || e));
  }
  // Extraction simple: balise meta og:description ou premier <p> significatif
  let shortDesc = '';
  let longDesc = '';
  try {
    // Parser léger sans DOMParser (sandbox renderer déjà dispo, mais DOMParser natif possible)
    // Utilisons DOMParser pour plus de robustesse
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const og = doc.querySelector('meta[property="og:description"]');
    if (og && og.getAttribute('content')) shortDesc = og.getAttribute('content').trim();
    // Fallback : premier paragraphe significatif
    if (!shortDesc) {
      const firstP = Array.from(doc.querySelectorAll('p')).find(p => p.textContent && p.textContent.trim().length > 40);
      if (firstP) shortDesc = firstP.textContent.trim().split(/\n/)[0];
    }
    const paragraphs = Array.from(doc.querySelectorAll('p')).map(p => p.textContent.trim()).filter(t => t.length > 0);
    longDesc = paragraphs.slice(0, 6).join('\n\n');
    if (longDesc.length > 1200) longDesc = longDesc.slice(0, 1170) + '…';
  } catch (e) {
    shortDesc = shortDesc || 'Description indisponible.';
    longDesc = longDesc || 'Impossible de parser la page distante.';
  }
  if (!shortDesc) shortDesc = 'Description non fournie.';
  if (!longDesc) longDesc = shortDesc;
  // Extraction des images potentielles (captures)
  let images = [];
  try {
    const parser2 = new DOMParser();
    const doc2 = parser2.parseFromString(html, 'text/html');
    const imgEls = Array.from(doc2.querySelectorAll('img'));
    // Filtrage: éviter icônes trop petites ou décoratives
    const filtered = imgEls.filter(img => {
      const src = img.getAttribute('src') || '';
      if (!src) return false;
      if (/icon|logo|badge|emoji/i.test(src)) return false;
      // Exclure images svg petites
      const w = parseInt(img.getAttribute('width') || '0', 10);
      const h = parseInt(img.getAttribute('height') || '0', 10);
      if ((w && w < 64) || (h && h < 64)) return false;
      return true;
    });
    images = filtered.map(i => i.getAttribute('src')).filter(Boolean);
    // Normaliser URLs relatives
    images = images.map(u => {
      if (/^https?:/i.test(u)) return u;
      // Assumer relatif au dossier /apps/
      return `https://portable-linux-apps.github.io/apps/${u.replace(/^\.\//,'')}`;
    });
    // Dédup + limite
    const seen = new Set();
    const finalImgs = [];
    for (const u of images) { if (!seen.has(u)) { seen.add(u); finalImgs.push(u); } }
    images = finalImgs.slice(0, 6);
  } catch(_) { images = []; }

  const record = { short: shortDesc, long: longDesc, images, timestamp: Date.now() };
  descriptionCache.set(appName, record);
  applyDescription(appName, record);
}

function applyDescription(appName, record) {
  if (!detailsName || detailsName.textContent.toLowerCase() !== appName.toLowerCase()) return;
  // Résumé supprimé : ne rien afficher
  if (detailsLong) { detailsLong.textContent = record.long; }
  if (detailsGalleryInner && detailsGallery) {
    detailsGalleryInner.innerHTML = '';
    if (record.images && record.images.length) {
      record.images.forEach(src => {
        const div = document.createElement('div');
        div.className = 'shot';
        const img = document.createElement('img');
        img.src = src;
        img.loading = 'lazy';
        img.onerror = () => { div.remove(); };
        img.addEventListener('click', () => openLightbox(record.images, record.images.indexOf(src), detailsName?.textContent || ''));
        div.appendChild(img);
        detailsGalleryInner.appendChild(div);
      });
      detailsGallery.hidden = false;
    } else {
      detailsGallery.hidden = true;
    }
  }
}

// Transforme le texte brut de description en HTML avec liens cliquables
function linkifyDescription(text) {
  if (!text) return '';
  // Échapper d'abord
  const escaped = text
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
  // Regex simple pour URLs http(s) (éviter de trop englober ponctuation finale)
  const urlRegex = /(https?:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+)(?=[\s)|\]}"'<>]|$)/g;
  const withLinks = escaped.replace(urlRegex, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
  // Newlines => <br>
  return withLinks.replace(/\n/g,'<br>');
}

// Surcharge applyDescription pour insérer HTML lien cliquable après récupération
const _origApplyDescription = applyDescription;
applyDescription = function(appName, record) { // eslint-disable-line no-global-assign
  if (!detailsName || detailsName.textContent.toLowerCase() !== appName.toLowerCase()) return;
  if (detailsLong) {
    detailsLong.innerHTML = linkifyDescription(record.long);
  }
  // Conserver galerie
  if (detailsGalleryInner && detailsGallery) {
    detailsGalleryInner.innerHTML = '';
    if (record.images && record.images.length) {
      record.images.forEach(src => {
        const div = document.createElement('div');
        div.className = 'shot';
        const img = document.createElement('img');
        img.src = src;
        img.loading = 'lazy';
        img.onerror = () => { div.remove(); };
        img.addEventListener('click', () => openLightbox(record.images, record.images.indexOf(src), detailsName?.textContent || ''));
        div.appendChild(img);
        detailsGalleryInner.appendChild(div);
      });
      detailsGallery.hidden = false;
    } else {
      detailsGallery.hidden = true;
    }
  }
};

function openLightbox(images, index, captionBase) {
  if (!lightbox || !lightboxImage) return;
  lightboxState.images = images || [];
  lightboxState.index = index || 0;
  lightboxState.originApp = captionBase;
  applyLightboxImage();
  lightbox.hidden = false;
  // Focus sur close pour accessibilité
  if (lightboxClose) setTimeout(()=> lightboxClose.focus(), 30);
}

function applyLightboxImage() {
  if (!lightboxImage) return;
  const src = lightboxState.images[lightboxState.index];
  lightboxImage.src = src;
  if (lightboxCaption) {
    lightboxCaption.textContent = `${lightboxState.originApp} – ${lightboxState.index+1}/${lightboxState.images.length}`;
  }
  updateLightboxNav();
}

function updateLightboxNav() {
  if (lightboxPrev) lightboxPrev.disabled = lightboxState.index <= 0;
  if (lightboxNext) lightboxNext.disabled = lightboxState.index >= lightboxState.images.length - 1;
  if (lightboxPrev) lightboxPrev.style.visibility = lightboxState.images.length > 1 ? 'visible' : 'hidden';
  if (lightboxNext) lightboxNext.style.visibility = lightboxState.images.length > 1 ? 'visible' : 'hidden';
}

function closeLightbox() {
  if (lightbox) lightbox.hidden = true;
}

lightboxPrev?.addEventListener('click', () => {
  if (lightboxState.index > 0) { lightboxState.index--; applyLightboxImage(); }
});
lightboxNext?.addEventListener('click', () => {
  if (lightboxState.index < lightboxState.images.length - 1) { lightboxState.index++; applyLightboxImage(); }
});
lightboxClose?.addEventListener('click', () => closeLightbox());
lightbox?.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});

window.addEventListener('keydown', (e) => {
  if (lightbox && !lightbox.hidden) {
    if (e.key === 'Escape') { closeLightbox(); }
    else if (e.key === 'ArrowLeft') { if (lightboxState.index > 0) { lightboxState.index--; applyLightboxImage(); } }
    else if (e.key === 'ArrowRight') { if (lightboxState.index < lightboxState.images.length - 1) { lightboxState.index++; applyLightboxImage(); } }
  }
});

