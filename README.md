# AppStore Electron

**AppStore Electron** est une application de bureau multiplateforme, construite avec [Electron](https://www.electronjs.org/), qui sert d’interface graphique simple pour installer, désinstaller et gérer des applications AppImage via [appman](https://github.com/AppImageCommunity/appman).

---

## Fonctionnalités

- **Affichage d’un catalogue d’applications** disponibles via appman, avec icônes.
- **Installation et désinstallation** d’apps en un clic.
- **Recherche rapide** et tri des logiciels (à venir).
- **Affichage des résultats et retour d’action** (succès/erreur).

---

## Prérequis

- [Node.js](https://nodejs.org/)
- [npm](https://www.npmjs.com/)
- [Electron](https://www.electronjs.org/)
- [appman](https://github.com/AppImageCommunity/appman) installé et accessible dans le PATH système

---

## Installation

Clone ce dépôt :

```bash
git clone https://github.com/Portable-Linux-Apps/appstore-electron.git
cd appstore-electron
npm install
```

---

## Utilisation

1. Assure-toi que `appman` est installé et fonctionnel (commande `appman -l` doit retourner la liste des applications).
2. Lance l’application Electron :

```bash
npm start
```

3. Parcoure, installe ou désinstalle les applications de ton choix !

---

## Architecture

- **main.js** : Gère la fenêtre Electron, la communication avec `appman` et transmet la liste des applications au renderer.
- **preload.js** : Sert de pont sécurisé entre le front (renderer) et le backend Electron.
- **renderer.js** : Génère dynamiquement l’interface utilisateur, gère les actions et l’affichage des icônes.

---

## Notes

- Les icônes sont récupérées automatiquement via le dépôt [Portable-Linux-Apps.github.io](https://github.com/Portable-Linux-Apps/Portable-Linux-Apps.github.io/tree/main/icons). Si une icône manque, une image par défaut est utilisée.
- Le parsing actuel extrait le nom court de chaque application pour l’affichage et la correspondance avec les icônes.

---

## Améliorations à venir

- Recherche et filtrage d’applications
- Affichage de la description complète des apps
- Gestion avancée des erreurs
- Amélioration du design

---

## Contribuer

Les contributions sont les bienvenues !  
N’hésitez pas à ouvrir une issue ou à proposer une pull request.

---

## Licence

[MIT](./LICENSE)