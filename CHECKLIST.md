Setup checklist — Windows desktop automation (Electron app)

1) Install dependencies

- Install robotjs and node-window-manager (native modules):

```bash
npm install robotjs node-window-manager clipboardy
```

2) Rebuild native modules for Electron

```bash
npx @electron/rebuild --force --parallel
```

3) Test window detection

- Start the app (`npm start`) and in DevTools require the service:

```js
const WinAuto = require('./src/services/WindowsAutomation');
// In main process console you can call:
WinAuto.focusWindow('Notepad', 2000).then(console.log).catch(console.error);
```

4) Test coordinate capture (manual step)

- Use the Excel Loop panel's "Rekam Koordinat" button (after UI integration) to trigger a 3s countdown and click anywhere; verify coordinates show.

5) Rebuild notes

- If Electron version differs from your system Node ABI, always run `npx @electron/rebuild` after `npm install`.
- On CI use: `npm ci && npx @electron/rebuild --arch=ia32, x64 --force` as needed.

6) Troubleshooting

- If `robotjs` install fails: ensure Windows build tools are available or use prebuilt binaries.
- For missing `node-window-manager`, coordinate-related functions will log informative errors and user can still use absolute clicks.

7) Next steps for the developer

- Wire `ipcMain.handle('capture-click-coordinates')` to call `WindowsAutomation.captureClickCoordinates` and relay result to renderer.
- Update `src/components/ExcelLoopPanel.js` to add new action types to the "Tambah Action" dropdown and implement the Rekam Koordinat flow (ipcRenderer.invoke).

