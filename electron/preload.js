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

  // Launch a sibling app (OrgΩr on :3002, KinOS on :3001)
  // Only works in Electron — button is hidden in browser mode
  launchApp: (appName) => ipcRenderer.invoke('launch-app', appName),

  // OS notification — fires for CRITICAL attention items detected on the bridge
  notify: (title, body) => ipcRenderer.invoke('notify', title, body),

  // Platform info for conditional UI (e.g. menu bar adjustments on macOS)
  platform:   process.platform,
  isElectron: true,
  version:    process.versions.electron,
});
