const { contextBridge, ipcRenderer } = require('electron');

// Expose API ke renderer secara aman
contextBridge.exposeInMainWorld('electronAPI', {
  // Generic invoke - untuk semua IPC call
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),

  // Send one-way
  send: (channel, data) => ipcRenderer.send(channel, data),

  // Listen untuk event dari main
  on: (channel, callback) => {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  },

  // Remove listener
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});

// Jika app lama pakai window.require, expose juga ini sebagai bridge
contextBridge.exposeInMainWorld('nodeAPI', {
  // Expose hanya yang benar-benar dibutuhkan renderer
  platform: process.platform,
  versions: process.versions,
});
