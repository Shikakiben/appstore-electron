function getIconUrl(app) {
  return `appicon://${app}.png`;
}

// --- Ajustement hauteur header & gestion erreurs (mode fenêtre native) ---
(function initHeaderMetrics(){
  const applyHeaderHeight = () => {
    const header = document.querySelector('.app-header');
    if (header) document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
    document.documentElement.style.setProperty('--tabs-h', '0px');
    const subBar = document.querySelector('.sub-bar');
    if (subBar) document.documentElement.style.setProperty('--subbar-h', subBar.offsetHeight + 'px');
  };
  window.addEventListener('resize', applyHeaderHeight);
  window.addEventListener('DOMContentLoaded', applyHeaderHeight);
  if (document.readyState !== 'loading') applyHeaderHeight();
  setTimeout(applyHeaderHeight, 80);
  setTimeout(applyHeaderHeight, 300);
  window.addEventListener('error', (ev) => {
    try {
      const t = document.getElementById('toast');
      if (t) { t.hidden = false; t.textContent = 'Erreur: ' + ev.message; setTimeout(()=>{ t.hidden = true; }, 5000); }
      console.error('Erreur globale', ev.error || ev.message);
    } catch(_){ }
  });
  window.addEventListener('unhandledrejection', (ev) => {
    try {
      const t = document.getElementById('toast');
      if (t) { t.hidden = false; t.textContent = 'Promesse rejetée: ' + (ev.reason?.message || ev.reason); setTimeout(()=>{ t.hidden = true; }, 6000); }
      console.error('Rejet non géré', ev.reason);
    } catch(_){ }
  });
})();

// --- Contrôles fenêtre (frameless) ---
document.addEventListener('click', (e) => {
  const b = e.target.closest('.win-btn');
  if (!b) return;
  const act = b.getAttribute('data-action');
  if (!act) return;
  try { window.electronAPI.windowControl(act); } catch(_) {}
});

// --- Application classe d'environnement de bureau (stylage léger et sans maintenance) ---
(() => {
  try {
    const de = (window.electronAPI?.desktopEnv && window.electronAPI.desktopEnv()) || 'generic';
    document.documentElement.classList.add('de-' + de);
  } catch(_) {}
})();

const modeMenuBtn = document.getElementById('modeMenuBtn');
const modeMenu = document.getElementById('modeMenu');
const modeOptions = () => Array.from(document.querySelectorAll('.mode-option'));
const state = {
  allApps: [], // [{name, installed}]
  filtered: [],
  activeCategory: 'all',
  viewMode: localStorage.getItem('viewMode') || 'grid',
  lastRenderKey: '',
  currentDetailsApp: null,
  renderVersion: 0,
  lastScrollY: 0,
  installed: new Set() // ensemble des noms installés (lowercase)
};

// --- (Ré)ajout gestion changement de mode d'affichage ---
function updateModeMenuUI() {
  // Mettre à jour états pressed
  modeOptions().forEach(opt => {
    const m = opt.getAttribute('data-mode');
    const active = m === state.viewMode;
    opt.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  // Changer l'icône du bouton principal selon mode
  const iconMap = { grid:'▦', list:'≣', icons:'◻︎', cards:'🂠' };
  if (modeMenuBtn) modeMenuBtn.textContent = iconMap[state.viewMode] || '▦';
}

if (modeMenuBtn && modeMenu) {
  modeMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !modeMenu.hidden;
    if (open) {
      modeMenu.hidden = true;
      modeMenuBtn.setAttribute('aria-expanded','false');
    } else {
      updateModeMenuUI();
      modeMenu.hidden = false;
      modeMenuBtn.setAttribute('aria-expanded','true');
    }
  });
  document.addEventListener('click', (ev) => {
    if (modeMenu.hidden) return;
    if (ev.target === modeMenu || modeMenu.contains(ev.target) || ev.target === modeMenuBtn) return;
    modeMenu.hidden = true;
    modeMenuBtn.setAttribute('aria-expanded','false');
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !modeMenu.hidden) {
      modeMenu.hidden = true; modeMenuBtn.setAttribute('aria-expanded','false');
    }
  });
  modeMenu.addEventListener('click', (ev) => {
    const opt = ev.target.closest('.mode-option');
    if (!opt) return;
    const mode = opt.getAttribute('data-mode');
    if (!mode || mode === state.viewMode) { modeMenu.hidden = true; modeMenuBtn.setAttribute('aria-expanded','false'); return; }
    if (!['grid','list','icons','cards'].includes(mode)) return;
    state.viewMode = mode;
    localStorage.setItem('viewMode', state.viewMode);
    updateModeMenuUI();
    render(state.filtered);
    modeMenu.hidden = true;
    modeMenuBtn.setAttribute('aria-expanded','false');
  });
}

updateModeMenuUI();

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
// Éléments streaming installation
const installStream = document.getElementById('installStream');
const installStreamStatus = document.getElementById('installStreamStatus');
const installStreamElapsed = document.getElementById('installStreamElapsed');
const installStreamLines = document.getElementById('installStreamLines');
const installStreamLog = document.getElementById('installStreamLog');
const installStreamToggle = document.getElementById('installStreamToggle');

// Mémoire de la session d'installation en cours pour restauration après retour
let activeInstallSession = {
  id: null,
  name: null,
  start: 0,
  lines: [], // tableau de chaînes
  done: false,
  success: null,
  code: null
};
// --- File d'attente séquentielle (Option 1) ---
const installQueue = []; // noms d'apps en attente (FIFO)

function getQueuePosition(name){
  const idx = installQueue.indexOf(name);
  return idx === -1 ? -1 : (idx + 1); // position 1-based
}

function removeFromQueue(name){
  const idx = installQueue.indexOf(name);
  if (idx === -1) return false;
  installQueue.splice(idx,1);
  try {
    if (typeof updateQueueIndicators === 'function') updateQueueIndicators();
    // Debounce pour éviter double refresh si plusieurs suppressions rapides
    if (window.__queueRefreshTimeout) clearTimeout(window.__queueRefreshTimeout);
    window.__queueRefreshTimeout = setTimeout(()=>{
      try { refreshAllInstallButtons(); } catch(e) { console.error('Erreur refreshAllInstallButtons', e); }
    }, 30);
    showToast(name + ' retirée de la file');
  } catch(e) {
    console.error('Erreur removeFromQueue', e);
    showToast('Erreur lors du retrait de la file');
  }
  return true;
}

function refreshDetailsInstallButtonForQueue(){
  if (!detailsInstallBtn || !detailsInstallBtn.getAttribute('data-name')) return;
  const name = detailsInstallBtn.getAttribute('data-name');
  if (!name) return;
  // Active en cours
  if (activeInstallSession.id && !activeInstallSession.done && activeInstallSession.name === name){
    // Bouton devient annulation
    detailsInstallBtn.disabled = false;
    detailsInstallBtn.classList.remove('loading');
    detailsInstallBtn.textContent = 'Installation… ✕';
    detailsInstallBtn.setAttribute('data-action','cancel-install');
    detailsInstallBtn.setAttribute('aria-label','Annuler installation en cours ('+name+')');
    return;
  }
  const pos = getQueuePosition(name);
  if (pos !== -1){
    detailsInstallBtn.disabled = false;
    detailsInstallBtn.classList.remove('loading');
    detailsInstallBtn.textContent = 'En file (#' + pos + ') ✕';
    detailsInstallBtn.setAttribute('data-action','remove-queue');
    detailsInstallBtn.setAttribute('aria-label', 'Retirer de la file (' + name + ')');
    return;
  }
  // Sinon si déjà installée, on masque ailleurs, mais reset label au cas où
  if (!detailsInstallBtn.hidden){
    detailsInstallBtn.textContent = 'Installer';
    detailsInstallBtn.classList.remove('loading');
    detailsInstallBtn.disabled = false;
    detailsInstallBtn.setAttribute('data-action','install');
  }
}

// Synchroniser aussi les boutons de la liste
function refreshListInstallButtons(){
  const buttons = document.querySelectorAll('.inline-action.install');
  buttons.forEach(btn => {
    const name = btn.getAttribute('data-app');
    if (!name) return;
    // Si appli déjà installée, ce bouton devrait avoir disparu après re-render.
    if (activeInstallSession.id && !activeInstallSession.done && activeInstallSession.name === name){
      btn.textContent = 'Installation… ✕';
      btn.disabled = false;
      btn.setAttribute('data-action','cancel-install');
      btn.setAttribute('aria-label','Annuler installation en cours ('+name+')');
      return;
    }
    const pos = getQueuePosition(name);
    if (pos !== -1){
      btn.textContent = 'En file (#' + pos + ') ✕';
      btn.disabled = false;
      btn.setAttribute('data-action','remove-queue');
      btn.setAttribute('aria-label','Retirer de la file (' + name + ')');
      return;
    }
    btn.textContent = 'Installer';
    btn.disabled = false;
    btn.setAttribute('data-action','install');
  });
}

function refreshAllInstallButtons(){
  refreshDetailsInstallButtonForQueue();
  refreshListInstallButtons();
  refreshTileBadges();
}

// Met à jour/injecte les badges d'état dans les modes non-list déjà rendus
function refreshTileBadges() {
  if (state.viewMode === 'list') return; // list géré par les boutons
  if (!state.installed || typeof state.installed.has !== 'function') return; // garde de sécurité
  const tiles = document.querySelectorAll('.app-tile');
  tiles.forEach(tile => {
    const name = tile.getAttribute('data-app');
    const installed = state.installed.has(name);
    const nameEl = tile.querySelector('.tile-name');
    if (!nameEl) return;
    // Supprimer badge existant
    const existing = nameEl.querySelector('.install-state-badge');
    if (existing) existing.remove();
    if (installed) return; // pas de badge si déjà installée
    let badgeHtml = '';
    if (activeInstallSession.id && !activeInstallSession.done && activeInstallSession.name === name) {
      // Ajouter bouton d'annulation dans le badge installation
      badgeHtml = '<span class="install-state-badge installing" data-state="installing">Installation…<button class="queue-remove-badge inline-action" data-action="cancel-install" data-app="'+name+'" title="Annuler" aria-label="Annuler l\'installation">✕</button></span>';
    } else {
      const pos = getQueuePosition(name);
      if (pos !== -1) badgeHtml = '<span class="install-state-badge queued" data-state="queued">En file (#'+pos+')<button class="queue-remove-badge inline-action" data-action="remove-queue" data-app="'+name+'" title="Retirer de la file" aria-label="Retirer">✕</button></span>';
    }
    if (badgeHtml) nameEl.insertAdjacentHTML('beforeend', ' ' + badgeHtml);
  });
}

function refreshQueueUI(){
  // Rafraîchit uniquement les représentations (badges + boutons) de la file.
  refreshAllInstallButtons();
}

function processNextInstall(){
  // Ne rien lancer si une installation active non terminée
  if (activeInstallSession.id && !activeInstallSession.done) return;
  if (!installQueue.length) return;
  const next = installQueue.shift();
  refreshQueueUI();
  // Nettoyer busy sur toutes les autres tuiles, puis marquer uniquement celle en cours
  document.querySelectorAll('.app-tile.busy').forEach(t => t.classList.remove('busy'));
  const tile = document.querySelector(`.app-tile[data-app="${CSS.escape(next)}"]`);
  if (tile) tile.classList.add('busy');
  const inlineBtn = document.querySelector(`.inline-action.install[data-app="${CSS.escape(next)}"]`);
  if (inlineBtn) inlineBtn.disabled = true;
  showToast('Installation de ' + next + '…');
  startStreamingInstall(next).catch(() => {
    // Fallback: exécuter via amAction puis enchaîner
    window.electronAPI.amAction('install', next).then(()=>{
      loadApps().then(()=> applySearch());
    }).finally(()=>{
      activeInstallSession.done = true;
      setTimeout(()=> processNextInstall(), 200);
    });
  });
  refreshAllInstallButtons();
}

function enqueueInstall(name){
  if (!name) return;
  // Vérifier si déjà en cours ou dans la file
  if ((activeInstallSession.name === name && !activeInstallSession.done) || installQueue.includes(name)) {
    showToast(name + ' déjà en cours ou en file');
    return;
  }
  if (activeInstallSession.id && !activeInstallSession.done) {
    installQueue.push(name);
  refreshQueueUI();
    showToast(name + ' ajouté à la file (' + installQueue.length + ')');
  } else {
    installQueue.push(name);
  refreshQueueUI();
    processNextInstall();
  }
  refreshAllInstallButtons();
}
const toast = document.getElementById('toast');
const searchInput = document.getElementById('searchInput');
const refreshBtn = document.getElementById('refreshBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const purgeIconsBtn = document.getElementById('purgeIconsBtn');
const purgeIconsResult = document.getElementById('purgeIconsResult');
const tabs = document.querySelectorAll('.tab');
// Mise à jour
const updatesPanel = document.getElementById('updatesPanel');
const advancedPanel = document.getElementById('advancedPanel');
const runUpdatesBtn = document.getElementById('runUpdatesBtn');
const updateSpinner = document.getElementById('updateSpinner');
const updateResult = document.getElementById('updateResult');
const updateFinalMessage = document.getElementById('updateFinalMessage');
const updatedAppsIcons = document.getElementById('updatedAppsIcons');
const installedCountEl = document.getElementById('installedCount');
// Modale sortie brute update
const showRawUpdateBtn = document.getElementById('showRawUpdateBtn');
const rawUpdateModal = document.getElementById('rawUpdateModal');
const rawUpdatePre = document.getElementById('rawUpdatePre');
const rawUpdateClose = document.getElementById('rawUpdateClose');
const rawUpdateClose2 = document.getElementById('rawUpdateClose2');
const rawCopyBtn = document.getElementById('rawCopyBtn');
const rawSaveBtn = document.getElementById('rawSaveBtn');
let lastUpdateRaw = '';
// (Ancien cadre résultat supprimé)
// Modale confirmation actions
const actionConfirmModal = document.getElementById('actionConfirmModal');
const actionConfirmMessage = document.getElementById('actionConfirmMessage');
const actionConfirmCancel = document.getElementById('actionConfirmCancel');
const actionConfirmOk = document.getElementById('actionConfirmOk');
let confirmResolve = null;
function openActionConfirm({ title, message, okLabel, intent }) {
  if (!actionConfirmModal) return Promise.resolve(false);
  actionConfirmMessage.innerHTML = message || '';
  actionConfirmOk.textContent = okLabel || 'Valider';
  // Intent styling (danger / install)
  actionConfirmOk.className = 'btn';
  if (intent === 'danger') {
    actionConfirmOk.classList.add('btn-soft-red');
  } else {
    actionConfirmOk.classList.add('btn-soft-blue');
  }
  if (actionConfirmCancel) actionConfirmCancel.className = 'btn-soft-neutral';
  actionConfirmModal.hidden = false;
  setTimeout(()=> actionConfirmOk.focus(), 30);
  return new Promise(res => { confirmResolve = res; });
}
function closeActionConfirm(result){
  if (!actionConfirmModal) return;
  actionConfirmModal.hidden = true;
  if (confirmResolve) { confirmResolve(result); confirmResolve = null; }
}
actionConfirmCancel?.addEventListener('click', ()=> closeActionConfirm(false));
actionConfirmOk?.addEventListener('click', ()=> closeActionConfirm(true));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && actionConfirmModal && !actionConfirmModal.hidden) {
    e.stopPropagation();
    closeActionConfirm(false);
  }
  if (e.key === 'Enter' && actionConfirmModal && !actionConfirmModal.hidden) {
    // Valide sur Enter uniquement si focus pas sur Cancel
    const active = document.activeElement;
    if (active !== actionConfirmCancel) {
      e.preventDefault();
      closeActionConfirm(true);
    }
  }
}, { capture:true });
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

// --- Préférences (thème & mode par défaut) ---
// S'assurer que le panneau des mises à jour est caché au démarrage (sauf si onglet updates actif)
if (updatesPanel) {
  updatesPanel.hidden = true; // l'onglet par défaut est 'all'
}
if (advancedPanel) {
  advancedPanel.hidden = true;
}
function applyThemePreference() {
  const pref = localStorage.getItem('themePref') || 'system';
  document.documentElement.classList.remove('theme-light','theme-dark');
  if (pref === 'light') document.documentElement.classList.add('theme-light');
  else if (pref === 'dark') document.documentElement.classList.add('theme-dark');
}
applyThemePreference();

// Pré-initialiser defaultMode si absent
if (!localStorage.getItem('defaultMode')) {
  localStorage.setItem('defaultMode', state.viewMode || 'grid');
}

// Ouvrir / fermer panneau paramètres
if (settingsBtn && settingsPanel) {
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !settingsPanel.hidden;
    if (isOpen) {
      settingsPanel.hidden = true;
      settingsBtn.setAttribute('aria-expanded','false');
    } else {
      // Synchroniser radios
      const themePref = localStorage.getItem('themePref') || 'system';
      settingsPanel.querySelectorAll('input[name="themePref"]').forEach(r => { r.checked = (r.value === themePref); });
      settingsPanel.hidden = false;
      settingsBtn.setAttribute('aria-expanded','true');
      // Focus panneau pour accessibilité
      setTimeout(()=> settingsPanel.focus(), 20);
    }
  });
  // Fermer clic extérieur
  document.addEventListener('click', (ev) => {
    if (settingsPanel.hidden) return;
    if (ev.target === settingsPanel || settingsPanel.contains(ev.target) || ev.target === settingsBtn) return;
    settingsPanel.hidden = true;
    settingsBtn.setAttribute('aria-expanded','false');
  });
  // Fermeture ESC
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !settingsPanel.hidden) {
      settingsPanel.hidden = true;
      settingsBtn.setAttribute('aria-expanded','false');
      settingsBtn.focus();
    }
    // Ctrl+, ouvre / toggle paramètres
    if ((ev.ctrlKey || ev.metaKey) && ev.key === ',') {
      if (settingsBtn) settingsBtn.click();
    }
  });
  // Radios thème
  settingsPanel.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.name === 'themePref') {
      localStorage.setItem('themePref', t.value);
      applyThemePreference();
    }
    // Fermer après choix
    settingsPanel.hidden = true;
    settingsBtn.setAttribute('aria-expanded','false');
    settingsBtn.focus();
  });

  // Purge cache icônes
  if (purgeIconsBtn) {
    purgeIconsBtn.addEventListener('click', async () => {
      purgeIconsBtn.disabled = true;
      const oldLabel = purgeIconsBtn.textContent;
      purgeIconsBtn.textContent = 'Vidage…';
      try {
        const res = await window.electronAPI.purgeIconsCache();
        if (purgeIconsResult) purgeIconsResult.textContent = (res && typeof res.removed === 'number') ? `${res.removed} fichier(s) supprimé(s).` : 'Terminé.';
        // Forcer rechargement visible: nettoyer attributs src pour celles déjà en cache
        document.querySelectorAll('.app-tile img').forEach(img => {
          if (img.src.startsWith('appicon://')) {
            const original = img.src; // déclencher rechargement en modifiant data-src
            img.removeAttribute('src');
            img.setAttribute('data-src', original);
            if (iconObserver) iconObserver.observe(img);
          }
        });
      } catch(e){ if (purgeIconsResult) purgeIconsResult.textContent = 'Erreur purge'; }
      finally {
        purgeIconsBtn.textContent = oldLabel;
        purgeIconsBtn.disabled = false;
      }
    });
  }
}


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
  // Construire l'ensemble des apps installées
  try {
    const installedNames = new Set();
    if (Array.isArray(detailed.installed)) {
      detailed.installed.forEach(entry => {
        if (!entry) return;
        if (typeof entry === 'string') installedNames.add(entry.toLowerCase());
        else if (entry.name) installedNames.add(String(entry.name).toLowerCase());
      });
    } else {
      // Fallback: dériver depuis allApps
      state.allApps.filter(a=>a && a.installed && a.name).forEach(a=> installedNames.add(a.name.toLowerCase()));
    }
    state.installed = installedNames;
  } catch(_) { state.installed = new Set(); }
  if (installedCountEl) installedCountEl.textContent = String((detailed.installed || []).length);
  render(state.filtered);
}

let iconObserver = null;
function initIconObserver(){
  if ('IntersectionObserver' in window && !iconObserver){
    iconObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting){
          const img = entry.target; const data = img.getAttribute('data-src');
          if (data){ img.src = data; img.removeAttribute('data-src'); }
          iconObserver.unobserve(img);
        }
      });
    }, { rootMargin: '600px' }); // marge accrue pour charger plus tôt hors écran
  }
}

// Rendu optimisé (batch + fragmentation + rendu différé pour longues listes)
const CHUNK_RENDER_THRESHOLD = 260; // au-delà de ce nombre on segmente
const CHUNK_SIZE = 90;
function render(list) {
  document.body.classList.remove('view-list','view-icons','view-grid','view-cards');
  if (state.viewMode === 'list') document.body.classList.add('view-list');
  else if (state.viewMode === 'icons') document.body.classList.add('view-icons');
  else if (state.viewMode === 'cards') document.body.classList.add('view-cards');
  else document.body.classList.add('view-grid');
  const key = state.viewMode + '|' + list.length + '|' + list.slice(0,60).map(a=>a.name+(a.installed?'+':'-')).join(',');
  if (key === state.lastRenderKey) return;
  state.lastRenderKey = key;
  state.renderVersion++;
  const version = state.renderVersion;
  if (!appsDiv) return;
  appsDiv.setAttribute('aria-busy','true');
  appsDiv.innerHTML = '';
  initIconObserver();

  // Fonction création tile (sans insertion directe)
  function buildTile(item){
    const { name, installed, desc } = typeof item === 'string' ? { name: item, installed: false, desc: null } : item;
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    let shortDesc = desc || (installed ? 'Déjà présente localement.' : 'Disponible pour installation.');
    if (shortDesc.length > 110) shortDesc = shortDesc.slice(0,107).trim() + '…';
    let actionsHTML = '';
    if (state.viewMode === 'list') {
      if (!installed) {
        let btnLabel = 'Installer';
        let actionAttr = 'install';
        let disabledAttr = '';
        if (activeInstallSession.id && !activeInstallSession.done && activeInstallSession.name === name){
          btnLabel = 'Installation… ✕';
          actionAttr = 'cancel-install';
        } else {
          const pos = getQueuePosition(name);
          if (pos !== -1) { btnLabel = 'En file (#'+pos+') ✕'; actionAttr='remove-queue'; }
        }
        actionsHTML = `<div class="actions"><button class="inline-action install" data-action="${actionAttr}" data-app="${name}"${disabledAttr}>${btnLabel}</button></div>`;
      } else {
        actionsHTML = `<div class="actions"><button class="inline-action uninstall" data-action="uninstall" data-app="${name}">Désinstaller</button></div>`;
      }
    }
    // Badge état pour modes sans bouton inline
    let stateBadge = '';
    if (state.viewMode !== 'list' && !installed) {
      if (activeInstallSession.id && !activeInstallSession.done && activeInstallSession.name === name) {
        // Ajouter une petite croix cliquable pour annuler (badge modes non-list)
        stateBadge = ' <span class="install-state-badge installing" data-state="installing">Installation…<button class="queue-remove-badge inline-action" data-action="cancel-install" data-app="'+name+'" title="Annuler" aria-label="Annuler">✕</button></span>';
      } else {
        const pos = getQueuePosition(name);
        if (pos !== -1) stateBadge = ' <span class="install-state-badge queued" data-state="queued">En file (#'+pos+')<button class="queue-remove-badge inline-action" data-action="remove-queue" data-app="'+name+'" title="Retirer de la file" aria-label="Retirer">✕</button></span>';
      }
    }
    const isCards = state.viewMode === 'cards';
    const tile = document.createElement('div');
    tile.className = 'app-tile';
    tile.setAttribute('data-app', name);
    tile.innerHTML = isCards ? `
      <img data-src="${getIconUrl(name)}" alt="${label}" loading="lazy" onerror="this.onerror=null; this.src='https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/${name}.png'; setTimeout(()=>{ if(this.naturalWidth<=1) this.src='https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/blank.png'; },1200);">
      <div class="tile-text">
        <div class="tile-name">${label} ${installed ? '<span class=\"installed-badge\" aria-label=\"Installée\" title=\"Installée\">✓</span>' : ''}${stateBadge}</div>
        <div class="tile-short">${shortDesc}</div>
      </div>` : `
      <img data-src="${getIconUrl(name)}" alt="${label}" loading="lazy" onerror="this.onerror=null; this.src='https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/${name}.png'; setTimeout(()=>{ if(this.naturalWidth<=1) this.src='https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/blank.png'; },1200);">
      <div class="tile-text">
        <div class="tile-name">${label} ${installed ? '<span class=\"installed-badge\" aria-label=\"Installée\" title=\"Installée\">✓</span>' : ''}${stateBadge}</div>
        <div class="tile-short">${shortDesc}</div>
      </div>
      ${actionsHTML}`;
    const img = tile.querySelector('img');
    if (img && img.getAttribute('data-src')) {
      // Ajouter un placeholder visuel (shimmer) le temps du chargement
      img.classList.add('img-loading');
      img.addEventListener('load', () => { img.classList.remove('img-loading'); }, { once:true });
      img.addEventListener('error', () => { img.classList.remove('img-loading'); }, { once:true });
      if (iconObserver) iconObserver.observe(img); else { img.src = img.getAttribute('data-src'); img.removeAttribute('data-src'); }
      // Prioriser les 24 premières images pour un rendu plus vif
      if (buildTile._count === undefined) buildTile._count = 0;
      if (buildTile._count < 24) {
        try { img.setAttribute('fetchpriority','high'); } catch(_){ }
      }
      buildTile._count++;
    }
    // Assurer l'ouverture de la vue détaillée (fallback si délégation globale perturbée)
    tile.tabIndex = 0; // navigation clavier
    tile.addEventListener('click', (ev) => {
      if (ev.target.closest('.inline-action')) return; // ne pas ouvrir si clic sur bouton d'action
      showDetails(name);
    });
    tile.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        if (ev.target.closest('.inline-action')) return;
        ev.preventDefault();
        showDetails(name);
      }
    });
    return tile;
  }

  if (list.length <= CHUNK_RENDER_THRESHOLD) {
    const frag = document.createDocumentFragment();
    for (const item of list) frag.appendChild(buildTile(item));
    // Utiliser requestAnimationFrame pour laisser respirer le thread
    requestAnimationFrame(() => {
      if (state.renderVersion !== version) return;
      appsDiv.appendChild(frag);
      appsDiv.setAttribute('aria-busy','false');
      // Synchroniser états install (après insertion DOM)
      refreshAllInstallButtons();
    });
  } else {
    let index = 0;
    function processChunk(){
      if (state.renderVersion !== version) return; // rendu obsolète
      const frag = document.createDocumentFragment();
      const end = Math.min(index + CHUNK_SIZE, list.length);
      for (let i=index; i<end; i++) frag.appendChild(buildTile(list[i]));
      appsDiv.appendChild(frag);
      index = end;
      if (index < list.length) {
        // Étaler sur idle ou prochain frame
        if ('requestIdleCallback' in window) {
          requestIdleCallback(processChunk, { timeout: 120 });
        } else {
          setTimeout(processChunk, 12);
        }
      } else {
        appsDiv.setAttribute('aria-busy','false');
        refreshAllInstallButtons();
      }
    }
    processChunk();
  }
}

function showDetails(appName) {
  const app = state.allApps.find(a => a.name === appName);
  if (!app) return;
  // Mémoriser la position de scroll actuelle (shell scrollable)
  const scroller = document.querySelector('.scroll-shell');
  if (scroller) state.lastScrollY = scroller.scrollTop;
  state.currentDetailsApp = app.name;
  const label = app.name.charAt(0).toUpperCase() + app.name.slice(1);
  if (detailsIcon) {
    detailsIcon.src = getIconUrl(app.name);
    detailsIcon.onerror = () => { detailsIcon.src = 'https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/blank.png'; };
  }
  if (detailsName) detailsName.textContent = app.installed ? `${label} ✓` : label;
  if (detailsName) detailsName.dataset.app = app.name.toLowerCase();
  if (detailsLong) detailsLong.textContent = 'Récupération distante en cours...\n\nNom interne: ' + app.name;
  if (detailsGallery) detailsGallery.hidden = true;
  if (detailsInstallBtn) {
    detailsInstallBtn.hidden = !!app.installed;
    detailsInstallBtn.disabled = false;
    detailsInstallBtn.setAttribute('data-name', app.name);
  }
  refreshAllInstallButtons();
  // Restaurer panneau streaming si une installation en cours correspond à cette app
  if (installStream) {
    if (activeInstallSession.id && !activeInstallSession.done && activeInstallSession.name === app.name) {
      installStream.hidden = false;
      if (installStreamLog) installStreamLog.textContent = activeInstallSession.lines.join('\n') + (activeInstallSession.lines.length?'\n':'');
      if (installStreamToggle) {
        installStreamToggle.setAttribute('aria-expanded','false');
        installStreamToggle.textContent = 'Afficher le log';
        installStreamLog.hidden = true;
      }
      if (installStreamLines) installStreamLines.textContent = activeInstallSession.lines.length + (activeInstallSession.lines.length>1?' lignes':' ligne');
      if (installStreamElapsed) {
        const secs = Math.round((performance.now()-activeInstallSession.start)/1000);
        installStreamElapsed.textContent = secs + 's';
      }
      if (installStreamStatus) installStreamStatus.textContent = 'En cours…';
      // Empêcher relance
      if (detailsInstallBtn) { detailsInstallBtn.disabled = true; detailsInstallBtn.classList.add('loading'); }
    } else {
      installStream.hidden = true;
      if (installStreamLog) installStreamLog.textContent='';
    }
  }
  if (detailsUninstallBtn) {
    detailsUninstallBtn.hidden = !app.installed;
    detailsUninstallBtn.disabled = false;
    detailsUninstallBtn.setAttribute('data-name', app.name);
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
  // Restaurer scroll
  const scroller = document.querySelector('.scroll-shell');
  if (scroller) scroller.scrollTop = state.lastScrollY || 0;
  // Mémoriser dernier détail pour potentielle restauration
  if (state.currentDetailsApp) sessionStorage.setItem('lastDetailsApp', state.currentDetailsApp);
});

function applySearch() {
  const q = (searchInput?.value || '').toLowerCase().trim();
  let base = state.allApps;
  if (state.activeCategory === 'updates') {
    if (updatesPanel) updatesPanel.hidden = false;
    if (advancedPanel) advancedPanel.hidden = true;
    render([]);
    return;
  }
  if (state.activeCategory === 'advanced') {
    if (advancedPanel) advancedPanel.hidden = false;
    if (updatesPanel) updatesPanel.hidden = true;
    render([]);
    return;
  }
  if (updatesPanel) updatesPanel.hidden = true;
  if (advancedPanel) advancedPanel.hidden = true;
  if (state.activeCategory === 'installed') {
    base = state.allApps.filter(a => a.installed);
  }
  state.filtered = !q ? base : base.filter(a => a.name.toLowerCase().includes(q));
  render(state.filtered);
}

// Listeners (vue détaillée) pour installation / désinstallation
detailsInstallBtn?.addEventListener('click', async () => {
  const name = detailsInstallBtn.getAttribute('data-name');
  if (!name) return;
  const action = detailsInstallBtn.getAttribute('data-action') || 'install';
  if (action === 'cancel-install') {
    if (activeInstallSession.id) {
      try { await window.electronAPI.installCancel(activeInstallSession.id); } catch(_){ }
      showToast('Annulation demandée…');
    }
    return;
  }
  if (action === 'remove-queue') { removeFromQueue(name); return; }
  const ok = await openActionConfirm({
    title: 'Confirmer l\'installation',
    message: `Installer <strong>${name}</strong> ?`,
    okLabel: 'Installer'
  });
  if (!ok) return;
  if (activeInstallSession.id && !activeInstallSession.done) {
    enqueueInstall(name);
    detailsInstallBtn.classList.remove('loading');
    refreshAllInstallButtons();
    return;
  }
  // Mise à jour immédiate du bouton avant réponse IPC pour meilleure réactivité
  detailsInstallBtn.classList.remove('loading');
  detailsInstallBtn.disabled = false;
  detailsInstallBtn.textContent = 'Installation… ✕';
  detailsInstallBtn.setAttribute('data-action','cancel-install');
  detailsInstallBtn.setAttribute('aria-label','Annuler installation en cours ('+name+')');
  enqueueInstall(name);
});

detailsUninstallBtn?.addEventListener('click', async () => {
  const name = detailsUninstallBtn.getAttribute('data-name');
  if (!name) return;
  const ok = await openActionConfirm({
    title: 'Confirmer la désinstallation',
    message: `Voulez-vous vraiment désinstaller <strong>${name}</strong> ?`,
    okLabel: 'Désinstaller',
    intent: 'danger'
  });
  if (!ok) return;
  detailsUninstallBtn.classList.add('loading');
  detailsUninstallBtn.disabled = true;
  showToast('Désinstallation de ' + name + '…');
  try {
    await window.electronAPI.amAction('uninstall', name);
  } finally {
    await loadApps();
    showDetails(name);
    detailsUninstallBtn.classList.remove('loading');
  }
});

appsDiv?.addEventListener('click', (e) => {
  const actionBtn = e.target.closest('.inline-action');
  if (actionBtn) {
    const action = actionBtn.getAttribute('data-action');
    const appName = actionBtn.getAttribute('data-app');
    if (!action || !appName) return;
    if (action === 'install') {
      openActionConfirm({
        title: 'Confirmer l\'installation',
        message: `Installer <strong>${appName}</strong> ?`,
        okLabel: 'Installer'
      }).then(ok => {
        if (!ok) return;
        // Désactiver uniquement ce bouton (pas les autres)
        actionBtn.disabled = true;
        const tile = actionBtn.closest('.app-tile');
        if (tile){ tile.classList.add('busy'); }
        enqueueInstall(appName);
      });
    } else if (action === 'uninstall') {
      openActionConfirm({
        title: 'Confirmer la désinstallation',
        message: `Voulez-vous vraiment désinstaller <strong>${appName}</strong> ?`,
        okLabel: 'Désinstaller',
        intent: 'danger'
      }).then(ok => {
        if (!ok) return;
        actionBtn.disabled = true;
        const tile = actionBtn.closest('.app-tile');
        if (tile){ tile.classList.add('busy'); }
        showToast('Désinstallation de ' + appName + '…');
        window.electronAPI.amAction('uninstall', appName).then(() => {
          loadApps().then(()=> applySearch());
        });
      });
    } else if (action === 'cancel-install') {
      if (activeInstallSession.id && activeInstallSession.name === appName) {
        window.electronAPI.installCancel(activeInstallSession.id).then(()=>{
          showToast('Annulation demandée…');
        });
      }
      return;
    } else if (action === 'remove-queue') {
      removeFromQueue(appName);
      return;
    }
    return;
  }
  const tile = e.target.closest('.app-tile');
  if (tile) showDetails(tile.getAttribute('data-app'));
});

// Debounce recherche pour éviter re-rendus superflus
function debounce(fn, delay){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), delay); }; }
searchInput?.addEventListener('input', debounce(applySearch, 140));
async function triggerRefresh() {
  if (!refreshBtn) return;
  if (refreshBtn.classList.contains('loading')) return; // éviter doubles clics
  showToast('Rafraîchissement…');
  refreshBtn.classList.add('loading');
  try {
    await loadApps();
    applySearch();
  } finally {
    setTimeout(()=> refreshBtn.classList.remove('loading'), 300); // petite latence pour lisibilité
    if (updateSpinner) updateSpinner.hidden = true;
  }
}
refreshBtn?.addEventListener('click', triggerRefresh);

// Unification des raccourcis clavier
window.addEventListener('keydown', (e) => {
  // Rafraîchissement clavier: Ctrl+R ou F5
  if ((e.key === 'r' && (e.ctrlKey || e.metaKey)) || e.key === 'F5') {
    e.preventDefault();
    triggerRefresh();
    return;
  }
  // Toggle paramètres Ctrl+,
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    settingsBtn?.click();
    return;
  }
  // Escape: fermer détails ou lightbox / menu modes / paramètres
  if (e.key === 'Escape') {
    if (lightbox && !lightbox.hidden) { closeLightbox(); return; }
    if (document.body.classList.contains('details-mode')) {
      if (appDetailsSection) appDetailsSection.hidden = true;
      document.body.classList.remove('details-mode');
      if (appsDiv) appsDiv.hidden = false; return;
    }
    if (!modeMenu?.hidden){ modeMenu.hidden = true; modeMenuBtn?.setAttribute('aria-expanded','false'); return; }
    if (!settingsPanel?.hidden){ settingsPanel.hidden = true; settingsBtn?.setAttribute('aria-expanded','false'); return; }
  }
  if (lightbox && !lightbox.hidden) {
    if (e.key === 'ArrowLeft') { if (lightboxState.index > 0) { lightboxState.index--; applyLightboxImage(); } }
    else if (e.key === 'ArrowRight') { if (lightboxState.index < lightboxState.images.length - 1) { lightboxState.index++; applyLightboxImage(); } }
  }
}, { capture:true });



(async () => {
  await loadApps();
  // Assurer spinner et résultats cachés au démarrage
  if (updateSpinner) updateSpinner.hidden = true;
  if (updateResult) updateResult.style.display = 'none';
  // Forcer la vue liste au démarrage
  if (appDetailsSection) appDetailsSection.hidden = true;
  document.body.classList.remove('details-mode');
  if (appsDiv) appsDiv.hidden = false;
  // Restaurer éventuel détail précédent (session) si encore présent
  const last = sessionStorage.getItem('lastDetailsApp');
  if (last && state.allApps.find(a=>a.name===last)) {
    showDetails(last);
  }
})();

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.activeCategory = tab.getAttribute('data-category') || 'all';
    applySearch();
    const isUpdates = state.activeCategory === 'updates';
    const isAdvanced = state.activeCategory === 'advanced';
    if (updatesPanel) updatesPanel.hidden = !isUpdates;
    if (advancedPanel) advancedPanel.hidden = !isAdvanced;
    if (!isUpdates && updateSpinner) updateSpinner.hidden = true;
    // Pas de terminal dans le mode avancé désormais
    if (document.body.classList.contains('details-mode')) {
      document.body.classList.remove('details-mode');
      if (appDetailsSection) appDetailsSection.hidden = true;
      if (appsDiv) appsDiv.hidden = false;
    }
  });
});

// (Terminal intégré supprimé)

// Sortie avec ESC
// (Ancien handler Escape détails fusionné ci-dessus)

// Bouton Mettre à jour: exécution simple (pas de progression heuristique)
function parseUpdatedApps(res){
  const updated = new Set();
  if (typeof res !== 'string') return updated;
  const lines = res.split(/\r?\n/);
  for (const raw of lines){
    const line = raw.trim();
    if (!line) continue;
    if (/Nothing to do here!?/i.test(line)) { updated.clear(); return updated; }
    // Motifs possibles:
    // ✔ appname
    // appname updated
    // Updating appname ...
    // * appname -> version
    // appname (old -> new)
    let name = null;
    let m;
    if ((m = line.match(/^✔\s+([A-Za-z0-9._-]+)/))) name = m[1];
    else if ((m = line.match(/^([A-Za-z0-9._-]+)\s+updated/i))) name = m[1];
    else if ((m = line.match(/^[Uu]pdating\s+([A-Za-z0-9._-]+)/))) name = m[1];
    else if ((m = line.match(/^\*\s*([A-Za-z0-9._-]+)\s+->/))) name = m[1];
    else if ((m = line.match(/^([A-Za-z0-9._-]+)\s*\([^)]*->[^)]*\)/))) name = m[1];
    if (name) {
      updated.add(name.toLowerCase());
    }
  }
  return updated;
}

function handleUpdateCompletion(fullText){
  // Chercher la section "The following apps have been updated:" dans le log
  let filteredUpdated = null;
  const match = fullText && fullText.match(/The following apps have been updated:[^\n]*\n([\s\S]*?)\n[-=]{5,}/i);
  if (match) {
    // Extraire les noms d'apps de cette section
    filteredUpdated = new Set();
    const lines = match[1].split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    for (const line of lines) {
      // ligne du type: ◆ citron-nightly 8f38c83a2
      const m = line.match(/^◆\s*([A-Za-z0-9._-]+)/);
      if (m) filteredUpdated.add(m[1].toLowerCase());
    }
  }
  const updated = parseUpdatedApps(fullText || '');
  const nothingPhrase = /Nothing to do here!?/i.test(fullText || '');
  let toShow = updated;
  if (filteredUpdated && filteredUpdated.size > 0) {
    // Ne garder que les apps détectées ET listées dans la section
    toShow = new Set([...updated].filter(x => filteredUpdated.has(x)));
  }
  if (toShow.size > 0) {
    if (updateFinalMessage) updateFinalMessage.textContent = 'Applications mises à jour :';
    if (updatedAppsIcons) {
      updatedAppsIcons.innerHTML = '';
      toShow.forEach(name => {
        const img = document.createElement('img'); img.src = getIconUrl(name); img.alt = name;
        img.onerror = () => { img.src = 'https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/blank.png'; };
        updatedAppsIcons.appendChild(img);
      });
    }
  } else {
    // Fallback: pas de noms détectés mais sortie non vide et pas de message "rien à faire" => supposer des mises à jour
    if (!nothingPhrase && (fullText || '').trim()) {
      if (updateFinalMessage) updateFinalMessage.textContent = 'Mises à jour effectuées (détails dans la sortie).';
    } else {
      if (updateFinalMessage) updateFinalMessage.textContent = 'Aucune mise à jour nécessaire.';
    }
    if (updatedAppsIcons) updatedAppsIcons.innerHTML = '';
  }
  if (updateResult) updateResult.style.display = 'block';
}

runUpdatesBtn?.addEventListener('click', async () => {
  if (runUpdatesBtn.disabled) return;
  showToast('Recherche de mises à jour…');
  updateSpinner.hidden = false;
  updateResult.style.display = 'none';
  updateFinalMessage.textContent='';
  updatedAppsIcons.innerHTML='';
  runUpdatesBtn.disabled = true;
  try {
    const start = performance.now();
    const res = await window.electronAPI.amAction('__update_all__');
    lastUpdateRaw = res || '';
    handleUpdateCompletion(res || '');
    await loadApps();
    applySearch();
    const dur = Math.round((performance.now()-start)/1000);
    if (updateFinalMessage && updateFinalMessage.textContent) updateFinalMessage.textContent += ` (Durée ${dur}s)`;
  // (Sortie supprimée)
  } catch(e){
  // (Sortie supprimée)
  } finally {
    updateSpinner.hidden = true;
    runUpdatesBtn.disabled = false;
  }
});

// --- Modale sortie brute ---
function openRawModal(){
  if (!rawUpdateModal) return;
  if (rawUpdatePre) rawUpdatePre.textContent = lastUpdateRaw || '(vide)';
  rawUpdateModal.hidden = false;
  setTimeout(()=> rawUpdatePre?.focus(), 30);
}
function closeRawModal(){ if (rawUpdateModal) rawUpdateModal.hidden = true; }

showRawUpdateBtn?.addEventListener('click', () => { if (!lastUpdateRaw) { showToast('Aucune sortie disponible'); return; } openRawModal(); });
rawUpdateClose?.addEventListener('click', closeRawModal);
rawUpdateClose2?.addEventListener('click', closeRawModal);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !rawUpdateModal?.hidden) closeRawModal(); }, { capture:true });
rawCopyBtn?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(lastUpdateRaw || ''); showToast('Copié'); } catch(_) { showToast('Impossible de copier'); }
});
rawSaveBtn?.addEventListener('click', () => {
  try {
    const blob = new Blob([lastUpdateRaw || ''], { type:'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:T]/g,'-').slice(0,19);
    a.download = 'update-log-'+ ts + '.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=> URL.revokeObjectURL(url), 2000);
  } catch(e){ showToast('Erreur sauvegarde'); }
});

// (Actions console supprimées)

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
  if (!detailsName) return;
  const refName = (detailsName.dataset.app || detailsName.textContent.toLowerCase().replace(/\s+✓$/, ''));
  if (refName !== appName.toLowerCase()) return;
  if (detailsLong) detailsLong.innerHTML = linkifyDescription(record.long);
  if (detailsGalleryInner && detailsGallery) {
    detailsGalleryInner.innerHTML = '';
    if (record.images && record.images.length) {
      record.images.forEach(src => {
        const div = document.createElement('div'); div.className='shot';
        const img = document.createElement('img'); img.src = src; img.loading='lazy';
        img.onerror = () => { div.remove(); };
        img.addEventListener('click', () => openLightbox(record.images, record.images.indexOf(src), detailsName?.textContent || ''));
        div.appendChild(img); detailsGalleryInner.appendChild(div);
      });
      detailsGallery.hidden = false;
    } else { detailsGallery.hidden = true; }
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

// (override supprimé, applyDescription fait déjà le travail)

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


// --- Streaming installation (Étapes 1 & 2) ---
let currentInstallId = null;
let currentInstallStart = 0;
let currentInstallLines = 0;

function startStreamingInstall(name){
  if (!window.electronAPI.installStart) {
    return Promise.reject(new Error('Streaming non supporté'));
  }
  // Marquer uniquement la tuile active busy (et enlever des autres)
  document.querySelectorAll('.app-tile.busy').forEach(t => t.classList.remove('busy'));
  const activeTile = document.querySelector(`.app-tile[data-app="${CSS.escape(name)}"]`);
  if (activeTile) activeTile.classList.add('busy');
  if (installStream) {
    installStream.hidden = false;
    if (installStreamStatus) installStreamStatus.textContent = 'Démarrage…';
  if (installStreamLog) { installStreamLog.textContent=''; installStreamLog.hidden = true; }
  if (installStreamToggle) { installStreamToggle.setAttribute('aria-expanded','false'); installStreamToggle.textContent='Afficher le log'; }
    if (installStreamLines) installStreamLines.textContent='0 lignes';
    if (installStreamElapsed) installStreamElapsed.textContent='0s';
  }
  currentInstallStart = performance.now();
  currentInstallLines = 0;
  activeInstallSession = { id: null, name, start: currentInstallStart, lines: [], done: false, success: null, code: null };
  return window.electronAPI.installStart(name).then(res => {
    if (res && res.error){
      showToast(res.error);
      if (installStream) installStream.hidden = true;
      detailsInstallBtn?.classList.remove('loading');
      detailsInstallBtn?.removeAttribute('disabled');
      return;
    }
    currentInstallId = res?.id || null;
    activeInstallSession.id = currentInstallId;
    // Rafraîchir les boutons maintenant que l'ID est connu
    refreshAllInstallButtons();
  });
}

if (window.electronAPI.onInstallProgress){
  window.electronAPI.onInstallProgress(msg => {
    if (!msg) return;
    if (currentInstallId && msg.id !== currentInstallId) return; // ignorer autres installations (future multi support)
    switch(msg.kind){
      case 'start':
        if (installStreamStatus) installStreamStatus.textContent = 'En cours…';
        // Assurer synchro du bouton détails si rendu avant ID
        refreshAllInstallButtons();
        break;
      case 'line':
        currentInstallLines++;
        if (installStreamLog){
          installStreamLog.textContent += msg.line + '\n';
          if (!installStreamLog.hidden) installStreamLog.scrollTop = installStreamLog.scrollHeight;
        }
        if (activeInstallSession && activeInstallSession.id === currentInstallId) {
          activeInstallSession.lines.push(msg.line);
          if (activeInstallSession.lines.length > 1200) {
            // Limite mémoire: garder dernières 1200 lignes
            activeInstallSession.lines = activeInstallSession.lines.slice(-1200);
          }
        }
        if (installStreamLines) installStreamLines.textContent = currentInstallLines + (currentInstallLines>1?' lignes':' ligne');
        if (installStreamElapsed){
          const secs = Math.round((performance.now()-currentInstallStart)/1000);
          installStreamElapsed.textContent = secs + 's';
        }
        break;
      case 'error':
        if (installStreamStatus) installStreamStatus.textContent = 'Erreur';
        detailsInstallBtn?.classList.remove('loading');
        detailsInstallBtn?.removeAttribute('disabled');
        setTimeout(()=> { if (installStream) installStream.hidden = true; }, 5000);
        break;
      case 'cancelled':
        if (installStreamStatus) installStreamStatus.textContent = 'Annulée';
        if (detailsInstallBtn) {
          detailsInstallBtn.classList.remove('loading');
          detailsInstallBtn.disabled = false;
          detailsInstallBtn.textContent = 'Installer';
          detailsInstallBtn.setAttribute('data-action','install');
        }
        if (activeInstallSession && activeInstallSession.id === currentInstallId) {
          activeInstallSession.done = true;
        }
        // Masquer le flux après court délai
        setTimeout(()=> { if (installStream) installStream.hidden = true; }, 1200);
        // Enchaîner la prochaine installation file (si existe)
        setTimeout(()=> { processNextInstall(); }, 500);
        refreshAllInstallButtons();
        break;
      case 'done':
        if (installStreamStatus) installStreamStatus.textContent = msg.success ? 'Terminé' : 'Échec ('+ msg.code +')';
        detailsInstallBtn?.classList.remove('loading');
        detailsInstallBtn?.removeAttribute('disabled');
        if (activeInstallSession && activeInstallSession.id === currentInstallId) {
          activeInstallSession.done = true;
          activeInstallSession.success = msg.success;
          activeInstallSession.code = msg.code;
        }
        // Ouvrir automatiquement le log si échec
        if (!msg.success && installStreamLog && installStreamToggle) {
          installStreamLog.hidden = false;
          installStreamToggle.setAttribute('aria-expanded','true');
          installStreamToggle.textContent='Masquer le log';
          requestAnimationFrame(()=> installStreamLog.scrollTop = installStreamLog.scrollHeight);
        }
        // rafraîchir liste + détails
        loadApps().then(()=> {
          if (msg.success) {
            if (msg.name) showDetails(msg.name); else if (detailsInstallBtn?.getAttribute('data-name')) showDetails(detailsInstallBtn.getAttribute('data-name'));
          }
          // Nettoyer busy/queue sur la tuile
          if (msg.name) {
            const tile = document.querySelector(`.app-tile[data-app="${CSS.escape(msg.name)}"]`);
            if (tile) tile.classList.remove('busy');
          }
          refreshQueueUI();
          // Actualiser tous les boutons
          refreshAllInstallButtons();
        });
        setTimeout(()=> { if (installStream) installStream.hidden = true; }, 3500);
        // Lancer l'installation suivante (léger délai UI)
        setTimeout(()=> processNextInstall(), 450);
        break;
    }
  });
}

// Toggle manuel log
if (installStreamToggle && installStreamLog){
  installStreamToggle.addEventListener('click', () => {
    const expanded = installStreamToggle.getAttribute('aria-expanded') === 'true';
    const next = !expanded;
    installStreamToggle.setAttribute('aria-expanded', String(next));
    installStreamToggle.textContent = next ? 'Masquer le log' : 'Afficher le log';
    installStreamLog.hidden = !next;
    if (next) requestAnimationFrame(()=> installStreamLog.scrollTop = installStreamLog.scrollHeight);
  });
}



