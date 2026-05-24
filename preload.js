'use strict';
const { ipcRenderer } = require('electron');

window.electronAPI = {
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, cb) => ipcRenderer.on(channel, (e, ...args) => cb(...args)),
  removeListener: (channel, cb) => ipcRenderer.removeListener(channel, cb),
  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch),
  setClipboard: (text) => ipcRenderer.invoke('set-clipboard', text),
  getClipboard: () => ipcRenderer.invoke('get-clipboard'),
  browseFile: (filters) => ipcRenderer.invoke('browse-file', filters),
  openChromeDebug: (port) => ipcRenderer.invoke('open-chrome-debug', { port }),
  testBrowserUrl: (cfg) => ipcRenderer.invoke('test-browser-url', cfg),
  testFocusWindow: (cfg) => ipcRenderer.invoke('test-focus-window', cfg),
  scanWindows: () => ipcRenderer.invoke('scan-open-windows'),
  saveFlow: (data) => ipcRenderer.invoke('save-flow', data),
  loadFlow: (id) => ipcRenderer.invoke('load-flow', id),
  getSavedFlows: () => ipcRenderer.invoke('get-saved-flows'),
  deleteFlow: (id) => ipcRenderer.invoke('delete-flow', id),
  macroStartRecording: (opts) => ipcRenderer.invoke('macro-start-recording', opts),
  macroStopRecording: () => ipcRenderer.invoke('macro-stop-recording'),
  macroGetEvents: () => ipcRenderer.invoke('macro-get-events'),
  macroPlay: (data) => ipcRenderer.invoke('macro-play', data),
  macroStopPlay: () => ipcRenderer.invoke('macro-stop-play'),
  macroPausePlay: () => ipcRenderer.invoke('macro-pause-play'),
  macroResumePlay: () => ipcRenderer.invoke('macro-resume-play'),
  macroSave: (data) => ipcRenderer.invoke('macro-save', data),
  macroList: () => ipcRenderer.invoke('macro-list'),
  macroLoad: (id) => ipcRenderer.invoke('macro-load', id),
  macroDelete: (id) => ipcRenderer.invoke('macro-delete', id),
};

console.log('[Preload] electronAPI ready');
