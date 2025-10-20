

function initXtermLog() {
  if (!xtermLogDiv) xtermLogDiv = document.getElementById('xtermLog');
  if (!xtermLogDiv) return;
  if (!xterm) {
    try {
      const { Terminal } = require('@xterm/xterm');
      const { FitAddon } = require('@xterm/xterm-addon-fit');
      xterm = new Terminal({
        fontSize: 13,
        fontFamily: 'monospace',
        theme: { background: '#181c20' },
        convertEol: true,
        scrollback: 2000,
        disableStdin: true,
        cursorBlink: false
      });
      xtermFit = new FitAddon();
      xterm.loadAddon(xtermFit);
      xterm.open(xtermLogDiv);
      window.addEventListener('resize', ()=>xtermFit.fit());
      xtermFit.fit();
    } catch (e) {
      xterm = null;
      xtermFit = null;
      if (xtermLogDiv) xtermLogDiv.style.display = 'none';
      if (installStreamLog) installStreamLog.style.display = '';
      return;
    }
  } else {
    xterm.clear();
    xtermFit && xtermFit.fit();
  }
  xtermLogDiv.style.display = '';
  if (installStreamLog) installStreamLog.style.display = 'none';
}
// --- xterm.js pour affichage terminal natif ---
let xterm = null;
let xtermFit = null;
let xtermLogDiv = null;
function getIconUrl(app) {
  return `appicon://${app}.png`;
}
// Fallback global : si une image `appicon://` échoue, charger depuis raw.githubusercontent
(function installAppiconFallback(){
  document.addEventListener('error', (ev) => {
    try {
      const el = ev.target;
      if (!el || el.tagName !== 'IMG') return;
      const src = String(el.src || '');
      if (!src.startsWith('appicon://')) return;
      // éviter les boucles de fallback
      if (el.dataset.__appiconFallbackTried) return;
      el.dataset.__appiconFallbackTried = '1';
      const name = src.replace(/^appicon:\/\//i, '').replace(/\?.*$/, '').replace(/#.*/, '');
      const remote = 'https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/' + name;
      // log for diagnostics
      try {
        console.warn('appicon fallback: replacing', src, 'with', remote);
        if (window.electronAPI && typeof window.electronAPI.purgeIconsCache !== 'undefined') {
          try { window.electronAPI.openExternal && window.electronAPI.openExternal(remote); } catch(_){}
        }
      } catch(_){}
      // Remplacer après un petit délai pour laisser le navigateur finir l'événement
      setTimeout(()=> { try { el.src = remote; } catch(_){} }, 10);
    } catch(_) {}
  }, true);
})();
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
const disableGpuCheckbox = document.getElementById('disableGpuCheckbox');
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

// --- Gestion accélération GPU ---
if (disableGpuCheckbox && window.electronAPI && window.electronAPI.getGpuPref && window.electronAPI.setGpuPref) {
  // Charger l'état au démarrage
  window.electronAPI.getGpuPref().then(val => {
    disableGpuCheckbox.checked = !!val;
  });
  disableGpuCheckbox.addEventListener('change', async () => {
    const val = !!disableGpuCheckbox.checked;
    await window.electronAPI.setGpuPref(val);
    // Afficher un toast traduit et proposer de relancer l'app
    showToast(val ? t('toast.gpuDisabled') : t('toast.gpuEnabled'));
    setTimeout(() => {
      if (confirm(t('confirm.gpuRestart'))) {
        window.location.reload();
      }
    }, 1200);
  });
}

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
// Log, compteur de lignes et bouton log supprimés de l'UI
const installProgressBar = document.getElementById('installStreamProgressBar');
const installProgressPercentLabel = document.getElementById('installStreamProgressPercent');
const installProgressEtaLabel = document.getElementById('installStreamEta');

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
  showToast(t('toast.removedFromQueue', {name}));
  } catch(e) {
    console.error('Erreur removeFromQueue', e);
  showToast(t('toast.removeQueueError'));
  }
  return true;
}

function refreshDetailsInstallButtonForQueue(){
  if (!detailsInstallBtn || !detailsInstallBtn.getAttribute('data-name')) return;
  detailsInstallBtn.classList.remove('loading'); // suppression systématique du spinner
  const name = detailsInstallBtn.getAttribute('data-name');
  if (!name) return;
  // Active en cours
  if (activeInstallSession.id && !activeInstallSession.done && activeInstallSession.name === name){
    // Bouton devient annulation
    detailsInstallBtn.disabled = false;
    detailsInstallBtn.classList.remove('loading');
    detailsInstallBtn.textContent = t('install.status') + ' ✕';
    detailsInstallBtn.setAttribute('data-action','cancel-install');
    detailsInstallBtn.setAttribute('aria-label', t('install.cancel') || 'Annuler installation en cours ('+name+')');
    return;
  }
  const pos = getQueuePosition(name);
  if (pos !== -1){
    detailsInstallBtn.disabled = false;
    detailsInstallBtn.classList.remove('loading');
    detailsInstallBtn.textContent = t('install.queued') ? t('install.queued').replace('{pos}', pos) : ('En file (#' + pos + ') ✕');
    detailsInstallBtn.setAttribute('data-action','remove-queue');
    detailsInstallBtn.setAttribute('aria-label', t('install.removeQueue') || ('Retirer de la file (' + name + ')'));
    return;
  }
  // Sinon si déjà installée, on masque ailleurs, mais reset label au cas où
  if (!detailsInstallBtn.hidden){
    detailsInstallBtn.textContent = t('details.install');
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
      btn.textContent = t('install.status') + ' ✕';
      btn.disabled = false;
      btn.setAttribute('data-action','cancel-install');
      btn.setAttribute('aria-label', t('install.cancel') || 'Annuler installation en cours ('+name+')');
      return;
    }
    const pos = getQueuePosition(name);
    if (pos !== -1){
      btn.textContent = t('install.queued') ? t('install.queued').replace('{pos}', pos) : ('En file (#' + pos + ') ✕');
      btn.disabled = false;
      btn.setAttribute('data-action','remove-queue');
      btn.setAttribute('aria-label', t('install.removeQueue') || ('Retirer de la file (' + name + ')'));
      return;
    }
    btn.textContent = t('details.install');
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
  showToast(t('toast.installing', {name: next}));
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
    showToast(t('toast.alreadyInQueue', {name}));
    return;
  }
  if (activeInstallSession.id && !activeInstallSession.done) {
    installQueue.push(name);
  refreshQueueUI();
  showToast(t('toast.addedToQueue', {name, count: installQueue.length}));
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
let updateInProgress = false;
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
// --- Gestion multilingue ---
const translations = {
  fr: {
    'toast.cancelRequested': 'Annulation demandée…',
    'settings.gpuTitle': 'Accélération GPU',
    'settings.gpuLabel': "Désactiver l'accélération GPU (pour corriger les bugs graphiques)",
    'toast.gpuDisabled': "L'accélération GPU sera désactivée au prochain démarrage.",
    'toast.gpuEnabled': "L'accélération GPU sera activée au prochain démarrage.",
    'confirm.gpuRestart': "Redémarrer l'application maintenant pour appliquer le changement d'accélération GPU ?",
    'updates.none': 'Aucune mise à jour nécessaire.',
    'updates.done': 'Mises à jour effectuées (détails dans la sortie).',
    'confirm.installTitle': "Confirmer l'installation",
    'confirm.installMsg': "Installer {name} ?",
    'confirm.uninstallTitle': "Confirmer la désinstallation",
    'confirm.uninstallMsg': "Voulez-vous vraiment désinstaller {name} ?",
    'install.starting': 'Démarrage…',
    'install.error': 'Erreur',
    'install.cancelled': 'Annulée',
    'install.done': 'Terminé',
    'install.failed': 'Échec (#{code})',
    'install.hideLog': 'Masquer le log',
    'install.status': 'En cours…',
    'install.log': 'Afficher le log',
    'install.cancel': 'Annuler installation en cours',
    'install.queued': 'En file (#{pos}) ✕',
    'install.removeQueue': 'Retirer de la file',
  'main.title': 'App Manager',
    'search.placeholder': 'Rechercher des applications…',
    'settings.theme': 'Thème',
    'settings.lang': 'Langue',
    'settings.auto': 'Auto',
    'settings.fr': 'Français',
    'settings.en': 'Anglais',
    'settings.it': 'Italien',
    'settings.light': 'Clair',
    'settings.dark': 'Sombre',
    'settings.coming': 'À venir',
    'settings.future': 'De nouvelles options seront ajoutées ici prochainement.',
    'settings.purge': 'Vider le cache des icônes',
    'settings.title': 'Paramètres',
  'settings.links': 'Liens',
  'settings.openExternal': 'Ouvrir les liens dans le navigateur externe',
    'window.min': 'Réduire',
    'window.max': 'Maximiser / Restaurer',
    'window.close': 'Fermer',
    'tabs.all': 'Tout',
    'tabs.installed': 'Installées',
    'tabs.updates': 'Mises à jour',
    'tabs.advanced': 'Mode avancé',
    'refresh.title': 'Rafraîchir la liste',
    'refresh.aria': 'Rafraîchir',
    'modeMenu.title': 'Changer de mode d\'affichage',
    'modeMenu.grid': 'Grille',
    'modeMenu.list': 'Liste',
    'modeMenu.icons': 'Icônes',
    'modeMenu.cards': 'Cartes',
    'updates.title': 'Mettre à jour AM et toutes les applications installées',
    'updates.run': 'Mettre à jour',
    'updates.loading': 'Recherche de mises à jour et installation si nécessaire…',
    'updates.details': 'Voir les détails…',
    'updates.updatedApps': 'Applications mises à jour :',
    'updates.duration': ' (Durée {dur}s)',
    'details.loadingDesc': 'Récupération distante en cours...\n\nNom interne: {name}',
    'details.errorDesc': 'Impossible de récupérer la description distante.\n{error}',
    'error.unknown': 'Erreur inconnue',
    'error.ipc': 'IPC échec: {msg}',
    'settings.purging': 'Vidage…',
    'settings.done': 'Terminé.',
    'settings.removedFiles': '{count} fichier(s) supprimé(s).',
    'settings.purgeError': 'Erreur purge',
    'toast.noUpdateLog': 'Aucun log de mise à jour disponible.',
    'toast.copied': 'Copié dans le presse-papiers.',
    'toast.copyError': 'Erreur de copie.',
    'toast.saveError': 'Erreur de sauvegarde.',
    'toast.refreshing': 'Rafraîchissement…',
    'toast.updating': 'Mise à jour en cours…',
    'toast.removedFromQueue': 'Retiré de la file d\'attente.',
    'toast.removeQueueError': 'Erreur lors de la suppression de la file.',
    'toast.alreadyInQueue': '{name} est déjà dans la file.',
    'toast.addedToQueue': '{name} ajouté à la file ({count} en attente).',
    'advanced.title': 'Mode avancé',
    'advanced.coming': 'À venir',
    'advanced.future': 'De nouvelles options seront ajoutées ici prochainement.',
      'advanced.waiting': 'Fonctions avancées encore non disponibles dans l’UI — utilisez le terminal : am -h pour la liste complète des commandes.',
      'advanced.cmd.help': 'aide',
      'advanced.cmd.list': 'lister les apps disponibles',
      'advanced.cmd.about': 'informations sur l\'app',
      'advanced.cmd.install': 'installer (ajouter --user pour local)',
      'advanced.cmd.query': 'rechercher',
      'advanced.cmd.update': 'mettre à jour (ou am -u {PROGRAM})',
      'advanced.cmd.updatemodules': 'mettre à jour AM/modules',
      'advanced.cmd.remove': 'supprimer',
      'advanced.cmd.extra': 'installer depuis GitHub',
      'advanced.cmd.translate': 'gérer traductions',
      'advanced.note.appman': 'Pour la version sans privilèges, remplacez am par appman',
      'advanced.docs': 'Documentation complète & guides →',
    'details.back': '← Retour',
    'details.desc': 'Description',
    'details.captures': 'Captures',
    'details.install': 'Installer',
    'details.uninstall': 'Désinstaller',
    'install.status': 'En cours…',
    'install.lines': '0 lignes',
    'install.log': 'Afficher le log',
    'lightbox.close': 'Fermer',
    'lightbox.prev': 'Précédente',
    'lightbox.next': 'Suivante',
    'modal.updateTitle': 'Détails de la mise à jour',
    'modal.close': 'Fermer',
    'modal.copy': 'Copier',
    'modal.save': 'Enregistrer…',
    'modal.closeBtn': 'Fermer',
    'confirm.cancel': 'Annuler',
    'confirm.ok': 'Valider',
  },
  en: {
    'toast.cancelRequested': 'Cancel requested…',
    'settings.gpuTitle': 'GPU acceleration',
    'settings.gpuLabel': 'Disable GPU acceleration (to fix graphics bugs)',
    'toast.gpuDisabled': 'GPU acceleration will be disabled on next launch.',
    'toast.gpuEnabled': 'GPU acceleration will be enabled on next launch.',
    'confirm.gpuRestart': 'Restart the application now to apply the GPU acceleration change?',
    'updates.none': 'No update needed.',
    'updates.done': 'Updates done (see output for details).',
    'confirm.installTitle': "Confirm installation",
    'confirm.installMsg': "Install {name}?",
    'confirm.uninstallTitle': "Confirm uninstall",
    'confirm.uninstallMsg': "Do you really want to uninstall {name}?",
    'install.starting': 'Starting…',
    'install.error': 'Error',
    'install.cancelled': 'Cancelled',
    'install.done': 'Done',
    'install.failed': 'Failed (#{code})',
    'install.hideLog': 'Hide log',
    'install.status': 'In progress…',
    'install.log': 'Show log',
    'install.cancel': 'Cancel ongoing installation',
    'install.queued': 'In queue (#{pos}) ✕',
    'install.removeQueue': 'Remove from queue',
    'main.title': 'AM App Store',
    'search.placeholder': 'Search for applications…',
    'settings.theme': 'Theme',
    'settings.lang': 'Language',
    'settings.auto': 'Auto',
    'settings.fr': 'French',
    'settings.en': 'English',
    'settings.it': 'Italian',
    'settings.light': 'Light',
    'settings.dark': 'Dark',
    'settings.coming': 'Coming soon',
    'settings.future': 'New options will be added here soon.',
    'settings.purge': 'Clear icon cache',
    'settings.title': 'Settings',
  'settings.links': 'Links',
  'settings.openExternal': 'Open links in external browser',
    'window.min': 'Minimize',
    'window.max': 'Maximize / Restore',
    'window.close': 'Close',
    'tabs.all': 'All',
    'tabs.installed': 'Installed',
    'tabs.updates': 'Updates',
    'tabs.advanced': 'Advanced mode',
    'refresh.title': 'Refresh list',
    'refresh.aria': 'Refresh',
    'modeMenu.title': 'Change display mode',
    'modeMenu.grid': 'Grid',
    'modeMenu.list': 'List',
    'modeMenu.icons': 'Icons',
    'modeMenu.cards': 'Cards',
    'updates.title': 'Update AM and all installed apps',
    'updates.run': 'Update',
    'updates.loading': 'Searching for updates and installing if needed…',
    'updates.details': 'Show details…',
    'updates.updatedApps': 'Updated apps:',
    'updates.duration': ' (Duration {dur}s)',
    'details.loadingDesc': 'Fetching remote description...\n\nInternal name: {name}',
    'details.errorDesc': 'Unable to fetch remote description.\n{error}',
    'error.unknown': 'Unknown error',
    'error.ipc': 'IPC failure: {msg}',
    'settings.purging': 'Purging…',
    'settings.done': 'Done.',
    'settings.removedFiles': '{count} file(s) removed.',
    'settings.purgeError': 'Purge error',
    'toast.noUpdateLog': 'No update log available.',
    'toast.copied': 'Copied to clipboard.',
    'toast.copyError': 'Copy error.',
    'toast.saveError': 'Save error.',
    'toast.refreshing': 'Refreshing…',
    'toast.updating': 'Updating…',
    'toast.removedFromQueue': 'Removed from queue.',
    'toast.removeQueueError': 'Error removing from queue.',
    'toast.alreadyInQueue': '{name} is already in queue.',
    'toast.addedToQueue': '{name} added to queue ({count} pending).',
    'advanced.title': 'Advanced mode',
    'advanced.coming': 'Coming soon',
    'advanced.future': 'New options will be added here soon.',
  'advanced.waiting': 'Advanced features are not yet available in the UI — use the terminal: am -h for the full command list.',
  'advanced.cmd.help': 'help',
  'advanced.cmd.list': 'list available apps',
  'advanced.cmd.about': 'show app information',
  'advanced.cmd.install': 'install (add --user for local)',
  'advanced.cmd.query': 'search',
  'advanced.cmd.update': 'update (or am -u {PROGRAM})',
  'advanced.cmd.updatemodules': 'update AM/modules',
  'advanced.cmd.remove': 'remove',
  'advanced.cmd.extra': 'install from GitHub',
  'advanced.cmd.translate': 'manage translations',
  'advanced.note.appman': 'For the non-privileged version, replace am with appman',
  'advanced.docs': 'Complete documentation & guides →',
    'details.back': '← Back',
    'details.desc': 'Description',
    'details.captures': 'Screenshots',
    'details.install': 'Install',
    'details.uninstall': 'Uninstall',
    'install.status': 'In progress…',
    'install.lines': '0 lines',
    'install.log': 'Show log',
    'lightbox.close': 'Close',
    'lightbox.prev': 'Previous',
    'lightbox.next': 'Next',
    'modal.updateTitle': 'Update details',
    'modal.close': 'Close',
    'modal.copy': 'Copy',
    'modal.save': 'Save…',
    'modal.closeBtn': 'Close',
    'confirm.cancel': 'Cancel',
    'confirm.ok': 'OK',
  },
  it: {
    'toast.cancelRequested': 'Annullamento richiesto…',
    'settings.gpuTitle': 'Accelerazione GPU',
    'settings.gpuLabel': 
      'Disattiva accelerazione GPU (per correggere bug grafici)',
    'toast.gpuDisabled': "L'accelerazione GPU sarà disabilitata al prossimo avvio.",
    'toast.gpuEnabled': "L'accelerazione GPU sarà abilitata al prossimo avvio.",
    'confirm.gpuRestart': "Riavviare l'applicazione ora per applicare la modifica dell'accelerazione GPU?",
    'updates.none': 'Nessun aggiornamento necessario.',
    'updates.done': 'Aggiornamenti completati (vedi dettagli nell’output).',
    'confirm.installTitle': "Conferma installazione",
    'confirm.installMsg': "Installare {name}?",
    'confirm.uninstallTitle': "Conferma disinstallazione",
    'confirm.uninstallMsg': "Vuoi davvero disinstallare {name}?",
    'install.starting': 'Avvio…',
    'install.error': 'Errore',
    'install.cancelled': 'Annullata',
    'install.done': 'Completato',
    'install.failed': 'Fallito (#{code})',
    'install.hideLog': 'Nascondi log',
    'install.status': 'In corso…',
    'install.log': 'Mostra log',
    'install.cancel': 'Annulla installazione in corso',
    'install.queued': 'In coda (#{pos}) ✕',
    'install.removeQueue': 'Rimuovi dalla coda',
    'main.title': 'AM App Store',
    'search.placeholder': 'Cerca applicazioni…',
    'settings.theme': 'Tema',
    'settings.lang': 'Lingua',
    'settings.auto': 'Auto',
    'settings.fr': 'Francese',
    'settings.en': 'Inglese',
    'settings.it': 'Italiano',
    'settings.light': 'Chiaro',
    'settings.dark': 'Scuro',
    'settings.coming': 'In arrivo',
    'settings.future': 'Nuove opzioni saranno aggiunte presto.',
    'settings.purge': 'Svuota cache icone',
    'settings.title': 'Impostazioni',
  'settings.links': 'Link',
  'settings.openExternal': 'Apri i link nel browser esterno',
    'window.min': 'Riduci',
    'window.max': 'Massimizza / Ripristina',
    'window.close': 'Chiudi',
    'tabs.all': 'Tutto',
    'tabs.installed': 'Installate',
    'tabs.updates': 'Aggiornamenti',
    'tabs.advanced': 'Modalità avanzata',
    'refresh.title': 'Aggiorna elenco',
    'refresh.aria': 'Aggiorna',
    'modeMenu.title': 'Cambia modalità di visualizzazione',
    'modeMenu.grid': 'Griglia',
    'modeMenu.list': 'Lista',
    'modeMenu.icons': 'Icone',
    'modeMenu.cards': 'Carte',
    'updates.title': 'Aggiorna AM e tutte le app installate',
    'updates.run': 'Aggiorna',
    'updates.loading': 'Ricerca aggiornamenti e installazione se necessario…',
    'updates.details': 'Mostra dettagli…',
    'updates.updatedApps': 'App aggiornate:',
    'updates.duration': ' (Durata {dur}s)',
    'details.loadingDesc': 'Recupero descrizione remota...\n\nNome interno: {name}',
    'details.errorDesc': 'Impossibile recuperare la descrizione remota.\n{error}',
    'error.unknown': 'Errore sconosciuto',
    'error.ipc': 'Fallimento IPC: {msg}',
    'settings.purging': 'Pulizia…',
    'settings.done': 'Completato.',
    'settings.removedFiles': '{count} file rimossi.',
    'settings.purgeError': 'Errore pulizia',
    'toast.noUpdateLog': 'Nessun log di aggiornamento disponibile.',
    'toast.copied': 'Copiato negli appunti.',
    'toast.copyError': 'Errore di copia.',
    'toast.saveError': 'Errore di salvataggio.',
    'toast.refreshing': 'Aggiornamento…',
    'toast.updating': 'Aggiornamento in corso…',
    'toast.removedFromQueue': 'Rimosso dalla coda.',
    'toast.removeQueueError': 'Errore nella rimozione dalla coda.',
    'toast.alreadyInQueue': '{name} è già in coda.',
    'toast.addedToQueue': '{name} aggiunto alla coda ({count} in attesa).',
    'advanced.title': 'Modalità avanzata',
    'advanced.coming': 'In arrivo',
    'advanced.future': 'Nuove opzioni saranno aggiunte presto.',
  'advanced.waiting': 'Le funzionalità avanzate non sono ancora disponibili nell\'interfaccia — usa il terminale: am -h per la lista completa dei comandi.',
  'advanced.cmd.help': 'aiuto',
  'advanced.cmd.list': "elenca le app disponibili",
  'advanced.cmd.about': "informazioni sull'app",
  'advanced.cmd.install': 'installa (aggiungi --user per locale)',
  'advanced.cmd.query': 'cerca',
  'advanced.cmd.update': "aggiorna (o am -u {PROGRAM})",
  'advanced.cmd.updatemodules': 'aggiorna AM/modules',
  'advanced.cmd.remove': 'rimuovi',
  'advanced.cmd.extra': 'installa da GitHub',
  'advanced.cmd.translate': 'gestisci traduzioni',
  'advanced.note.appman': "Per la versione senza privilegi, sostituisci am con appman",
  'advanced.docs': 'Documentazione completa & guide →',
    'details.back': '← Indietro',
    'details.desc': 'Descrizione',
    'details.captures': 'Screenshot',
    'details.install': 'Installa',
    'details.uninstall': 'Disinstalla',
    'install.status': 'In corso…',
    'install.lines': '0 righe',
    'install.log': 'Mostra log',
    'lightbox.close': 'Chiudi',
    'lightbox.prev': 'Precedente',
    'lightbox.next': 'Successiva',
    'modal.updateTitle': 'Dettagli aggiornamento',
    'modal.close': 'Chiudi',
    'modal.copy': 'Copia',
    'modal.save': 'Salva…',
    'modal.closeBtn': 'Chiudi',
    'confirm.cancel': 'Annulla',
    'confirm.ok': 'Conferma',
  }
};

function getSystemLang() {
  try {
    // Prefer value fournie par le main / preload si disponible
    const sys = (window.electronAPI && typeof window.electronAPI.systemLocale === 'function') ? window.electronAPI.systemLocale() : null;
    const navLang = sys || navigator.language || navigator.userLanguage || 'fr';
    const code = String(navLang).toLowerCase().split(/[-_.]/)[0];
    if (code === 'fr' || code.startsWith('fr')) return 'fr';
    if (code === 'it' || code.startsWith('it')) return 'it';
    if (code === 'en' || code.startsWith('en')) return 'en';
    // default fallback
    return 'en';
  } catch(_) { return 'en'; }
}

function getLangPref() {
  const pref = localStorage.getItem('langPref') || 'auto';
  if (pref === 'auto') return getSystemLang();
  return pref;
}

function t(key) {
  const lang = getLangPref();
  let str = (translations[lang] && translations[lang][key]) || (translations['en'] && translations['en'][key]) || (translations['fr'] && translations['fr'][key]) || key;
  if (arguments.length > 1 && typeof str === 'string') {
    const vars = arguments[1];
    Object.entries(vars).forEach(([k, v]) => {
      str = str.replace(new RegExp(`#?\{${k}\}`, 'g'), v);
    });
  }
  return str;
}

function applyTranslations() {
  // Boutons dynamiques détails (install/uninstall)
  if (detailsInstallBtn) detailsInstallBtn.textContent = t('details.install');
  if (detailsUninstallBtn) detailsUninstallBtn.textContent = t('details.uninstall');
  if (installStreamStatus) installStreamStatus.textContent = t('install.status');
  // Traduction générique de tous les éléments data-i18n et data-i18n-*
  const lang = getLangPref();
  // data-i18n (texte)
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang] && translations[lang][key]) {
      el.textContent = translations[lang][key];
    }
  });
  // data-i18n-placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (translations[lang] && translations[lang][key]) {
      el.setAttribute('placeholder', translations[lang][key]);
    }
  });
  // data-i18n-title, data-i18n-aria-label, etc.
  document.querySelectorAll('[data-i18n-title], [data-i18n-aria-label]').forEach(el => {
    if (el.hasAttribute('data-i18n-title')) {
      const key = el.getAttribute('data-i18n-title');
      if (translations[lang] && translations[lang][key]) {
        el.title = translations[lang][key];
      }
    }
    if (el.hasAttribute('data-i18n-aria-label')) {
      const key = el.getAttribute('data-i18n-aria-label');
      if (translations[lang] && translations[lang][key]) {
        el.setAttribute('aria-label', translations[lang][key]);
      }
    }
  });
  // Attributs spéciaux (ex: aria-label sur settingsPanel)
  const settingsPanel = document.getElementById('settingsPanel');
  if (settingsPanel) {
    settingsPanel.setAttribute('aria-label', t('settings.title'));
  }
  // Titre bouton paramètres
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) settingsBtn.title = t('settings.title') + ' (Ctrl+,)';
}

// Appliquer la langue au chargement
window.addEventListener('DOMContentLoaded', () => {
  applyTranslations();
  // Mettre à jour l'attribut lang du HTML
  document.documentElement.setAttribute('lang', getLangPref());
  // Synchroniser l'état des radios de sélection de langue avec la préférence enregistrée
  try {
    const stored = localStorage.getItem('langPref') || 'auto';
    const radios = document.querySelectorAll('input[name="langPref"]');
    radios.forEach(r => { try { r.checked = (r.value === stored); } catch(_){} });
    // Ajouter un gestionnaire direct pour éviter toute ambiguïté de délégation
    radios.forEach(r => {
      try {
        r.addEventListener('change', (ev) => {
          ev.stopPropagation();
          try { localStorage.setItem('langPref', r.value); } catch(_){ }
          try { applyTranslations(); } catch(_){ }
          try { document.documentElement.setAttribute('lang', getLangPref()); } catch(_){ }
          // Mark handled to avoid delegated double handling
          try { window.__langChangeHandled = true; } catch(_){ }
          // Correction : n'affiche la liste des applications que si l'onglet actif est un onglet 'application'
          const appTabs = ['all', 'installed'];
          if (appTabs.includes(state.activeCategory)) {
            try { render(state.filtered); refreshAllInstallButtons(); } catch(_){}
            if (appsDiv) appsDiv.hidden = false;
            if (updatesPanel) updatesPanel.hidden = true;
            if (advancedPanel) advancedPanel.hidden = true;
          } else {
            if (appsDiv) appsDiv.hidden = true;
            if (updatesPanel) updatesPanel.hidden = (state.activeCategory !== 'updates');
            if (advancedPanel) advancedPanel.hidden = (state.activeCategory !== 'advanced');
          }
        });
      } catch(_){}
    });
  } catch(_) {}
});

// Gérer le changement de langue
const settingsPanelLang = document.getElementById('settingsPanel');
if (settingsPanelLang) {
  settingsPanelLang.addEventListener('change', (ev) => {
    const t = ev.target;
    // évite double gestion si un handler direct a déjà traité
    if (window.__langChangeHandled) { window.__langChangeHandled = false; return; }
    if (t.name === 'langPref') {
      localStorage.setItem('langPref', t.value);
      applyTranslations();
      document.documentElement.setAttribute('lang', getLangPref());
  // Appliquer les traductions dynamiquement sans recharger
  try { applyTranslations(); } catch(_){}
  try { document.documentElement.setAttribute('lang', getLangPref()); } catch(_){}
  try { render(state.filtered); refreshAllInstallButtons(); } catch(_){}
    }
  });
}

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
      purgeIconsBtn.textContent = t('settings.purging');
      try {
        const res = await window.electronAPI.purgeIconsCache();
        if (purgeIconsResult) purgeIconsResult.textContent = (res && typeof res.removed === 'number') ? t('settings.removedFiles', {count: res.removed}) : t('settings.done');
        // Forcer rechargement visible: nettoyer attributs src pour celles déjà en cache
        document.querySelectorAll('.app-tile img').forEach(img => {
          if (img.src.startsWith('appicon://')) {
            const original = img.src; // déclencher rechargement en modifiant data-src
            img.removeAttribute('src');
            img.setAttribute('data-src', original);
            if (iconObserver) iconObserver.observe(img);
          }
        });
      } catch(e){ if (purgeIconsResult) purgeIconsResult.textContent = t('settings.purgeError'); }
      finally {
        purgeIconsBtn.textContent = oldLabel;
        purgeIconsBtn.disabled = false;
      }
    });
  }
}



// --- Opening external links preference ---
// Key: openExternalLinks (string '1' == true)
const openExternalCheckbox = document.getElementById('openExternalLinksCheckbox');
function loadOpenExternalPref() {
  try {
    const v = localStorage.getItem('openExternalLinks');
    return v === '1';
  } catch(_) { return false; }
}
function saveOpenExternalPref(val) {
  try { localStorage.setItem('openExternalLinks', val ? '1' : '0'); } catch(_){}
}
// Initialiser checkbox état à l'ouverture du panneau
if (openExternalCheckbox) {
  try { openExternalCheckbox.checked = loadOpenExternalPref(); } catch(_){}
  openExternalCheckbox.addEventListener('change', (ev) => {
    try { saveOpenExternalPref(openExternalCheckbox.checked); } catch(_){}
  });
}

// Global click interception for anchors to optionally open externally
document.addEventListener('click', (ev) => {
  try {
    const a = ev.target.closest && ev.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    // Only handle absolute http(s) links
    if (!/^https?:\/\//i.test(href)) return;
    const openExternal = loadOpenExternalPref();
    if (!openExternal) return; // default behaviour
    ev.preventDefault();
    ev.stopPropagation();
    // Ask main to open externally if API available
    if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
      window.electronAPI.openExternal(href).then(res => {
        if (!res || !res.ok) console.warn('openExternal failed', res && res.error);
      }).catch(err => console.warn('openExternal error', err));
    } else {
      // Fallback
      try { window.open(href, '_blank', 'noopener'); } catch(e) { console.warn('fallback open', e); }
    }
  } catch(_){}
}, { capture: true });
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
    detailed = { all: [], installed: [], error: t('error.ipc', {msg: e?.message || e}) };
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
  if (installedCountEl) installedCountEl.textContent = String(state.allApps.filter(a => a.installed && a.hasDiamond).length);
  render(state.filtered);
}

let iconObserver = null;
function initIconObserver(){
  if ('IntersectionObserver' in window && !iconObserver){
    // Charger plus tôt hors-écran pour réduire latence à l'apparition lors du scroll
    iconObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting){
          const img = entry.target; const data = img.getAttribute('data-src');
          if (data){ img.src = data; img.removeAttribute('data-src'); }
          iconObserver.unobserve(img);
        }
      });
    }, { rootMargin: '1200px' }); // marge accrue pour charger encore plus tôt hors écran
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
    const version = (item && item.version) ? String(item.version) : null;
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
        actionsHTML = `<div class=\"actions\"><button class=\"inline-action install\" data-action=\"${actionAttr}\" data-app=\"${name}\"${disabledAttr}>${btnLabel}</button></div>`;
      } else {
        actionsHTML = `<div class=\"actions\">`;
        actionsHTML += `<button class=\"inline-action uninstall\" data-action=\"uninstall\" data-app=\"${name}\">${t('details.uninstall')}</button>`;
        actionsHTML += `</div>`;
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
  <img data-src="${getIconUrl(name)}" alt="${label}" loading="lazy" decoding="async" onerror="this.onerror=null; this.src='https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/${name}.png'; setTimeout(()=>{ if(this.naturalWidth<=1) this.src='https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/blank.png'; },1200);">
      <div class="tile-text">
        <div class="tile-name">${label}${version? ` <span class=\"tile-version\">${version}</span>`: ''} ${installed ? '<span class=\"installed-badge\" aria-label=\"Installée\" title=\"Installée\">✓</span>' : ''}${stateBadge}</div>
        <div class="tile-short">${shortDesc}</div>
      </div>` : `
  <img data-src="${getIconUrl(name)}" alt="${label}" loading="lazy" decoding="async" onerror="this.onerror=null; this.src='https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/${name}.png'; setTimeout(()=>{ if(this.naturalWidth<=1) this.src='https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/blank.png'; },1200);">
      <div class="tile-text">
        <div class="tile-name">${label}${version? ` <span class=\"tile-version\">${version}</span>`: ''} ${installed ? '<span class=\"installed-badge\" aria-label=\"Installée\" title=\"Installée\">✓</span>' : ''}${stateBadge}</div>
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
      if (buildTile._count < 48) {
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
      // Déclencher préchargement non bloquant des icônes restantes
      try { prefetchPreloadImages(300, 6); } catch(_){}
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
        try { prefetchPreloadImages(300, 6); } catch(_){}
      }
    }
    processChunk();
  }
}

// Préchargement async throttlé des images encore non démarrées — démarre après rendu
let _prefetchScheduled = false;
function prefetchPreloadImages(limit = 200, concurrency = 6) {
  // Ne pas relancer si déjà planifié
  if (_prefetchScheduled) return;
  _prefetchScheduled = true;
  // Récupérer les images qui portent encore data-src
  const imgs = Array.from(document.querySelectorAll('img[data-src]'));
  if (!imgs.length) return;
  // Trier par proximité avec le haut de la fenêtre
  imgs.sort((a,b) => (a.getBoundingClientRect().top || 0) - (b.getBoundingClientRect().top || 0));
  const toLoad = imgs.slice(0, Math.min(limit, imgs.length));
  let idx = 0;
  let active = 0;
  function nextBatch(){
    while (active < concurrency && idx < toLoad.length) {
      const img = toLoad[idx++];
      active++;
      // Start load on next frame to avoid blocking
      requestAnimationFrame(()=>{
        try { if (img.getAttribute('data-src')) { img.src = img.getAttribute('data-src'); img.removeAttribute('data-src'); } } catch(_){}
        active--; if (idx < toLoad.length) setTimeout(nextBatch, 0);
      });
    }
  }
  // lancer après un court délai pour laisser le rendu initial se stabiliser
  setTimeout(nextBatch, 180);
}

function showDetails(appName) {
  const app = state.allApps.find(a => a.name === appName);
  if (!app) return;
  // Mémoriser la position de scroll actuelle (shell scrollable)
  const scroller = document.querySelector('.scroll-shell');
  if (scroller) state.lastScrollY = scroller.scrollTop;
  state.currentDetailsApp = app.name;
  const label = app.name.charAt(0).toUpperCase() + app.name.slice(1);
  const version = app.version ? String(app.version) : null;
  if (detailsIcon) {
    detailsIcon.src = getIconUrl(app.name);
    detailsIcon.onerror = () => { detailsIcon.src = 'https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/blank.png'; };
  }
  if (detailsName) {
    // Correction : si installation annulée, ne pas afficher comme installée
    const isActuallyInstalled = app.installed && !(activeInstallSession && activeInstallSession.name === app.name && activeInstallSession.id && !activeInstallSession.done);
    if (isActuallyInstalled) {
      detailsName.innerHTML = `${label}${version ? ' · ' + version : ''} <span class="installed-badge" aria-label="Installée" title="Installée">✓</span>`;
    } else {
      detailsName.textContent = version ? `${label} · ${version}` : label;
    }
  }
  if (detailsName) detailsName.dataset.app = app.name.toLowerCase();
  if (detailsLong) detailsLong.textContent = t('details.loadingDesc', {name: app.name});
  if (detailsGallery) detailsGallery.hidden = true;
  if (detailsInstallBtn) {
    detailsInstallBtn.hidden = !!app.installed;
    detailsInstallBtn.setAttribute('data-name', app.name);
    // Toujours retirer le spinner et réactiver le bouton
  detailsInstallBtn.classList.remove('loading');
  detailsInstallBtn.disabled = false;
    if (activeInstallSession.id && !activeInstallSession.done && activeInstallSession.name === app.name) {
      detailsInstallBtn.textContent = t('install.status') + ' ✕';
      detailsInstallBtn.setAttribute('data-action','cancel-install');
      detailsInstallBtn.setAttribute('aria-label', t('install.cancel') || 'Annuler installation en cours ('+app.name+')');
    } else {
      detailsInstallBtn.textContent = t('details.install');
      detailsInstallBtn.setAttribute('data-action','install');
      detailsInstallBtn.setAttribute('aria-label', t('details.install'));
    }
    refreshAllInstallButtons();
  }
  // Restaurer panneau streaming si une installation en cours correspond à cette app
  if (installStream) {
    if (activeInstallSession.id && !activeInstallSession.done && activeInstallSession.name === app.name) {
      installStream.hidden = false;
      if (installStreamElapsed) {
        const secs = Math.round((performance.now()-activeInstallSession.start)/1000);
        installStreamElapsed.textContent = secs + 's';
      }
      if (detailsInstallBtn) { detailsInstallBtn.disabled = false; detailsInstallBtn.classList.remove('loading'); }
    } else {
      installStream.hidden = true;
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
    if (detailsLong) detailsLong.textContent = t('details.errorDesc', {error: err?.message || err || t('error.unknown')});
  });
}

backToListBtn?.addEventListener('click', () => {
  if (appDetailsSection) appDetailsSection.hidden = true;
  document.body.classList.remove('details-mode');
  if (appsDiv) appsDiv.hidden = false;
  // Nettoyer tous les états busy/spinner sur les tuiles
  document.querySelectorAll('.app-tile.busy').forEach(t => t.classList.remove('busy'));
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
    if (appsDiv) appsDiv.innerHTML = '';
    return;
  }
  if (state.activeCategory === 'advanced') {
    if (advancedPanel) advancedPanel.hidden = false;
    if (updatesPanel) updatesPanel.hidden = true;
    render([]);
    if (appsDiv) appsDiv.innerHTML = '';
    return;
  }
  if (updatesPanel) updatesPanel.hidden = true;
  if (advancedPanel) advancedPanel.hidden = true;
  if (state.activeCategory === 'installed') {
    // Show only installed apps that were marked with leading '◆' in the source list
    base = state.allApps.filter(a => a.installed && (a.hasDiamond === true));
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
  showToast(t('toast.cancelRequested'));
    }
    return;
  }
  if (action === 'remove-queue') { removeFromQueue(name); return; }
  const ok = await openActionConfirm({
  title: t('confirm.installTitle'),
  message: t('confirm.installMsg', {name: `<strong>${name}</strong>`}),
  okLabel: t('details.install')
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
  title: t('confirm.uninstallTitle'),
  message: t('confirm.uninstallMsg', {name: `<strong>${name}</strong>`}),
  okLabel: t('details.uninstall'),
  intent: 'danger'
  });
  if (!ok) return;
  detailsUninstallBtn.classList.add('loading');
  detailsUninstallBtn.disabled = true;
  showToast(t('toast.uninstalling', {name}));
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
        title: t('confirm.installTitle'),
        message: t('confirm.installMsg', {name: `<strong>${appName}</strong>`}),
        okLabel: t('details.install')
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
        title: t('confirm.uninstallTitle'),
        message: t('confirm.uninstallMsg', {name: `<strong>${appName}</strong>`}),
        okLabel: t('details.uninstall'),
        intent: 'danger'
      }).then(ok => {
        if (!ok) return;
        actionBtn.disabled = true;
        const tile = actionBtn.closest('.app-tile');
        if (tile){ tile.classList.add('busy'); }
  showToast(t('toast.uninstalling', {name: appName}));
        window.electronAPI.amAction('uninstall', appName).then(() => {
          loadApps().then(()=> applySearch());
        });
      });
    } else if (action === 'cancel-install') {
      if (activeInstallSession.id && activeInstallSession.name === appName) {
        window.electronAPI.installCancel(activeInstallSession.id).then(()=>{
          showToast(t('toast.cancelRequested'));
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
  showToast(t('toast.refreshing'));
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

  // Gestion du prompt de choix interactif pendant installation
  window.electronAPI?.onInstallProgress?.((data) => {
    console.log('[DEBUG] IPC install-progress reçu:', JSON.stringify(data));
    // Initialiser la session d'installation à la réception de 'start'
    if (data.kind === 'start' && data.id) {
      window.activeInstallSession = { id: data.id };
    }
    if (data.kind === 'choice-prompt') {
      // Supprimer toute boîte de dialogue de choix existante
      document.querySelectorAll('.choice-dialog').forEach(e => e.remove());
      // Créer un dialogue simple
      const dlg = document.createElement('div');
      dlg.className = 'choice-dialog';
      dlg.style.position = 'fixed';
      dlg.style.top = '50%';
      dlg.style.left = '50%';
      dlg.style.transform = 'translate(-50%, -50%)';
      dlg.style.zIndex = '9999';
      dlg.style.background = '#fff';
      dlg.style.boxShadow = '0 2px 16px rgba(0,0,0,0.18)';
      dlg.style.borderRadius = '10px';
      dlg.style.padding = '24px 32px';
      dlg.style.minWidth = '320px';
      let optionsHtml;
      if (data.options.length > 8) {
        // Affichage en tableau 2 colonnes
        const colCount = 2;
        const rowCount = Math.ceil(data.options.length / colCount);
        optionsHtml = '<table class="multi-choice-table"><tbody>';
        for (let r = 0; r < rowCount; r++) {
          optionsHtml += '<tr>';
          for (let c = 0; c < colCount; c++) {
            const idx = r + c * rowCount;
            if (idx < data.options.length) {
              optionsHtml += `<td><button class="multi-choice-item" data-choice="${idx+1}">${data.options[idx]}</button></td>`;
            } else {
              optionsHtml += '<td></td>';
            }
          }
          optionsHtml += '</tr>';
        }
        optionsHtml += '</tbody></table>';
      } else {
        // Affichage classique en liste
        optionsHtml = `<ul>${data.options.map((opt,i)=>`<li><button class="multi-choice-item" data-choice="${i+1}">${opt}</button></li>`).join('')}</ul>`;
      }
      dlg.innerHTML = `<div class="choice-dialog-inner" style="user-select:text;"><h3>${data.prompt}</h3>${optionsHtml}</div>`;
      document.body.appendChild(dlg);
      dlg.querySelectorAll('button[data-choice]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const choice = btn.getAttribute('data-choice');
          // Fermer la boîte de dialogue immédiatement
          dlg.remove();
          // Envoi du choix au backend
          const installId = data.id;
          if (!installId) {
            window.showCopiableError('Erreur : identifiant d’installation manquant.');
            return;
          }
          console.log('[CHOICE-CLICK] Envoi du choix', choice, 'pour id', installId);
          try {
            await window.electronAPI.installSendChoice(installId, choice);
          } catch(e) {
            window.showCopiableError('Erreur lors de l’envoi du choix : ' + (e?.message || e));
          }
        });
      });
    }
    // Fermer le prompt si l'installation est terminée ou annulée
    if (data.kind === 'done' || data.kind === 'cancelled' || data.kind === 'error') {
      document.querySelectorAll('.choice-dialog').forEach(e => e.remove());
    }
  });

// Fonction utilitaire globale pour afficher une erreur copiable
window.showCopiableError = function(msg) {
  const errDlg = document.createElement('div');
  errDlg.style.position = 'fixed';
  errDlg.style.top = '50%';
  errDlg.style.left = '50%';
  errDlg.style.transform = 'translate(-50%, -50%)';
  errDlg.style.zIndex = '10000';
  errDlg.style.background = '#fff';
  errDlg.style.boxShadow = '0 2px 16px rgba(0,0,0,0.18)';
  errDlg.style.borderRadius = '10px';
  errDlg.style.padding = '24px 32px';
  errDlg.style.minWidth = '320px';
  errDlg.innerHTML = `<div style="margin-bottom:12px;font-weight:bold;">Erreur</div><textarea style="width:100%;height:80px;resize:none;user-select:text;">${msg}</textarea><div style="text-align:right;margin-top:12px;"><button>Fermer</button></div>`;
  document.body.appendChild(errDlg);
  errDlg.querySelector('button').onclick = () => errDlg.remove();
  const ta = errDlg.querySelector('textarea');
  ta.focus();
  ta.select();
};
})();

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.activeCategory = tab.getAttribute('data-category') || 'all';
    applySearch();
    // Fermer tout prompt de choix interactif lors du changement d’onglet
    document.querySelectorAll('.choice-dialog').forEach(e => e.remove());
    const isUpdatesTab = state.activeCategory === 'updates';
    const isAdvancedTab = state.activeCategory === 'advanced';
    if (updatesPanel) updatesPanel.hidden = !isUpdatesTab;
    if (advancedPanel) advancedPanel.hidden = !isAdvancedTab;
    if (!isUpdatesTab && updateSpinner) updateSpinner.hidden = true;
    if (isUpdatesTab) {
      if (updateInProgress) {
        runUpdatesBtn.disabled = true;
        updateSpinner.hidden = false;
      } else {
        runUpdatesBtn.disabled = false;
        updateSpinner.hidden = true;
      }
    }
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
    if (updateFinalMessage) updateFinalMessage.textContent = t('updates.updatedApps');
    if (updatedAppsIcons) {
      updatedAppsIcons.innerHTML = '';
      toShow.forEach(nameLower => {
        const wrapper = document.createElement('div'); wrapper.className = 'updated-item';
        const img = document.createElement('img');
        // nameLower comes from parsed output (lowercased). Try to find matching app object for proper casing and version
        const appObj = state.allApps.find(a => String(a.name).toLowerCase() === String(nameLower).toLowerCase());
        const displayName = appObj ? (appObj.name) : nameLower;
        const displayVersion = appObj && appObj.version ? appObj.version : null;
        img.src = getIconUrl(displayName);
        img.alt = displayName;
        img.onerror = () => { img.src = 'https://raw.githubusercontent.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/main/icons/blank.png'; };
        const meta = document.createElement('div'); meta.className = 'updated-meta';
        const title = document.createElement('div'); title.className = 'updated-name'; title.textContent = displayName;
        const ver = document.createElement('div'); ver.className = 'updated-version'; ver.textContent = displayVersion ? String(displayVersion) : '';
        if (!displayVersion) ver.hidden = true;
        meta.appendChild(title);
        meta.appendChild(ver);
        wrapper.appendChild(img);
        wrapper.appendChild(meta);
        updatedAppsIcons.appendChild(wrapper);
      });
    }
  } else {
    // Fallback: pas de noms détectés mais sortie non vide et pas de message "rien à faire" => supposer des mises à jour
    if (!nothingPhrase && (fullText || '').trim()) {
      if (updateFinalMessage) updateFinalMessage.textContent = t('updates.done');
    } else {
      if (updateFinalMessage) updateFinalMessage.textContent = t('updates.none');
    }
    if (updatedAppsIcons) updatedAppsIcons.innerHTML = '';
  }
  if (updateResult) updateResult.style.display = 'block';
  // Rafraîchir la liste complète pour mettre à jour les versions installées
  setTimeout(() => { loadApps().then(applySearch); }, 400);
}

runUpdatesBtn?.addEventListener('click', async () => {
  if (runUpdatesBtn.disabled) return;
  updateInProgress = true;
  showToast(t('toast.updating'));
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
    try {
      const needs = state.allApps.some(a => a.installed && (!a.version || String(a.version).toLowerCase().includes('unsupported')));
      if (needs) {
        await new Promise(r => setTimeout(r, 3000));
        await loadApps();
        applySearch();
      }
    } catch (_) {}
    const dur = Math.round((performance.now()-start)/1000);
    if (updateFinalMessage && updateFinalMessage.textContent) updateFinalMessage.textContent += t('updates.duration', {dur});
  } catch(e){
    // (Sortie supprimée)
  } finally {
    updateInProgress = false;
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

showRawUpdateBtn?.addEventListener('click', () => { if (!lastUpdateRaw) { showToast(t('toast.noUpdateLog')); return; } openRawModal(); });
rawUpdateClose?.addEventListener('click', closeRawModal);
rawUpdateClose2?.addEventListener('click', closeRawModal);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !rawUpdateModal?.hidden) closeRawModal(); }, { capture:true });
rawCopyBtn?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(lastUpdateRaw || ''); showToast(t('toast.copied')); } catch(_) { showToast(t('toast.copyError')); }
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
  } catch(e){ showToast(t('toast.saveError')); }
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
let installElapsedInterval = null;


function startStreamingInstall(name){
  initXtermLog();
  if (!window.electronAPI.installStart) {
    return Promise.reject(new Error('Streaming non supporté'));
  }
  // Marquer uniquement la tuile active busy (et enlever des autres)
  document.querySelectorAll('.app-tile.busy').forEach(t => t.classList.remove('busy'));
  const activeTile = document.querySelector(`.app-tile[data-app="${CSS.escape(name)}"]`);
  if (activeTile) activeTile.classList.add('busy');
    if (installStream) {
      installStream.hidden = false;
      if (installStreamElapsed) installStreamElapsed.textContent='0s';
      if (installProgressPercentLabel) installProgressPercentLabel.textContent = '';
      if (installProgressBar) {
        installProgressBar.value = 0;
        installProgressBar.max = 100;
        installProgressBar.removeAttribute('hidden');
      }
    }
  currentInstallStart = Date.now();
  currentInstallLines = 0;
  activeInstallSession = { id: null, name, start: currentInstallStart, lines: [], done: false, success: null, code: null };
  // Démarrer le vrai chronomètre temps réel
  if (installElapsedInterval) clearInterval(installElapsedInterval);
  installElapsedInterval = setInterval(() => {
    if (installStreamElapsed) {
      const secs = Math.floor((Date.now() - currentInstallStart) / 1000);
      installStreamElapsed.textContent = secs + 's';
    }
  }, 1000);
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
    if (msg.kind === 'line') {
      // --- Extraction du pourcentage de progression depuis le flux ---
      if (msg.raw !== undefined) {
        // Cherche un motif du type "  6%[>" ou " 99%[" ou "100%["
        const percentMatch = msg.raw.match(/(\d{1,3})%\[/);
        if (percentMatch) {
          let percent = parseInt(percentMatch[1], 10);
          if (!isNaN(percent)) {
            if (installProgressPercentLabel) installProgressPercentLabel.textContent = percent + '%';
            if (installProgressBar) installProgressBar.value = percent;
          }
        }
        // Extraction brute du temps restant (formats "eta ...", "ETA ...", "Temps restant ...", "remaining ...")
        let eta = '';
        let m = msg.raw.match(/(?:ETA|eta|Temps restant|remaining)[\s:]+([^\s][^\r\n]*)/i);
        if (m) eta = m[1].trim();
        if (installProgressEtaLabel) installProgressEtaLabel.textContent = eta ? `⏳ ${eta}` : '';
      }
      // (Le temps écoulé est maintenant géré par le chronomètre JS)
      return;
    }
    switch(msg.kind){
      case 'start':
        if (installStreamStatus) installStreamStatus.textContent = t('install.status');
        refreshAllInstallButtons();
        if (installProgressBar) installProgressBar.value = 0;
        break;
      case 'error':
        if (installStreamStatus) installStreamStatus.textContent = t('install.error') || 'Erreur';
        detailsInstallBtn?.classList.remove('loading');
        detailsInstallBtn?.removeAttribute('disabled');
        setTimeout(()=> { if (installStream) installStream.hidden = true; }, 5000);
        if (installProgressBar) installProgressBar.value = 0;
        if (installElapsedInterval) { clearInterval(installElapsedInterval); installElapsedInterval = null; }
        break;
      case 'cancelled':
        if (installStreamStatus) installStreamStatus.textContent = t('install.cancelled') || 'Annulée';
        if (detailsInstallBtn) {
          detailsInstallBtn.classList.remove('loading');
          detailsInstallBtn.disabled = false;
        }
        if (installProgressBar) installProgressBar.value = 0;
        if (installElapsedInterval) { clearInterval(installElapsedInterval); installElapsedInterval = null; }
        setTimeout(()=> { if (installStream) installStream.hidden = true; }, 2000);
        // (Correction annulée : on ne rafraîchit plus la liste ni les détails ici)
        break;
      case 'done':
        if (installStreamStatus) installStreamStatus.textContent = t('install.done') || 'Terminé';
        if (installProgressBar) installProgressBar.value = 100;
        if (installElapsedInterval) { clearInterval(installElapsedInterval); installElapsedInterval = null; }
        setTimeout(()=> { if (installStream) installStream.hidden = true; }, 2000);
        // --- Suite logique d'après l'ancien code (fusionner les deux 'done') ---
        detailsInstallBtn?.classList.remove('loading');
        detailsInstallBtn?.removeAttribute('disabled');
        if (activeInstallSession && activeInstallSession.id === currentInstallId) {
          activeInstallSession.done = true;
          activeInstallSession.success = msg.success;
          activeInstallSession.code = msg.code;
        }
        // Plus de gestion du log ou du bouton log ici
        loadApps().then(()=> {
          if (msg.success) {
            if (msg.name) showDetails(msg.name); else if (detailsInstallBtn?.getAttribute('data-name')) showDetails(detailsInstallBtn.getAttribute('data-name'));
          }
          if (msg.name) {
            const tile = document.querySelector(`.app-tile[data-app="${CSS.escape(msg.name)}"]`);
            if (tile) tile.classList.remove('busy');
          }
          refreshQueueUI();
          refreshAllInstallButtons();
        });
        setTimeout(()=> { if (installStream) installStream.hidden = true; }, 3500);
        setTimeout(()=> processNextInstall(), 450);
        break;
    }
  });
}
// Ancien bloc switch/case dupliqué supprimé : tout est géré dans le switch précédent





