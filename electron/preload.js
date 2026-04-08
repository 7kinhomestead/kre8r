/**
 * Kre8Ωr Desktop — electron/preload.js
 * Context bridge: exposes a safe, minimal API to the renderer (web app).
 * Never expose Node.js APIs directly — only curated methods via contextBridge.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kre8rElectron', {
  // Called when an OAuth redirect comes back via kre8r:// protocol
  onOAuthCallback: (callback) => {
    ipcRenderer.on('oauth-callback', (_, url) => callback(url));
  },

  // Native folder picker — returns selected path string or null if cancelled
  pickFolder: () => ipcRenderer.invoke('pick-folder'),

  // Platform info for conditional UI (e.g. menu bar adjustments on macOS)
  platform:   process.platform,
  isElectron: true,
  version:    process.versions.electron,
});
