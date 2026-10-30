// The only bridge between the screens and Windows: list the installed printers and print a slip to one.
// Nothing else from Node.js or Electron is reachable from the page (context isolation, sandbox).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('masterBillDesktop', {
  printers: () => ipcRenderer.invoke('printers'),
  print: (job) => ipcRenderer.invoke('print', job),
});
