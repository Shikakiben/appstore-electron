# AM-AppStore

**AM-AppStore** is an Electron-based application that serves as a graphical App Store for [AM](https://github.com/ivan-hc/AM). "AM"/"AppMan" is a set of scripts and modules for installing, updating, and managing AppImage packages and other portable formats on Linux.

⚠️ **This project is not yet functional: it is under active development and some features may not work or may be incomplete.**

---

## Features

- **Displays a catalog of AppImage applications** available via AM/appman, with icons.
- **One-click installation and removal** of AppImage applications.
- **Fast search and sorting** of software (coming soon).
- **Displays results and action feedback** (success/error).

---

## Requirements

- [Node.js](https://nodejs.org/)
- [npm](https://www.npmjs.com/)
- [Electron](https://www.electronjs.org/)
- [AM](https://github.com/ivan-hc/AM) installed and accessible in the system PATH
- **Linux only** (AppImage management is not supported on Windows/Mac)

---

## Installation

Clone this repository:

```bash
git clone https://github.com/Shikakiben/AM-AppStore-Test.git
cd AM-AppStore
npm install
```

---

## Usage

1. Make sure `AM` or `appman` is installed and functional (`am -l` or `appman -l` should return the list of applications).
2. Launch the app:

```bash
npm start
```

3. Browse, install, or uninstall the AppImage applications of your choice!

---

## Architecture

- **main.js**: Manages the Electron window, communicates with `AM`/`appman`, and sends the application list to the renderer.
- **preload.js**: Provides a secure bridge between the frontend (renderer) and Electron's backend.
- **renderer.js**: Dynamically generates the user interface, handles actions, and displays icons.

---

## Acknowledgements

Thanks to [Ivan](https://github.com/ivan-hc) and the [pkgforge community](https://github.com/pkgforge-dev) for their outstanding work on managing and distributing AppImages on Linux.

---

## License

[MIT](./LICENSE)