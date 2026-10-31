// Puente seguro entre la ventana y el proceso principal (la ventana no tiene acceso directo a Node).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  llamar: (canal, ...args) => ipcRenderer.invoke('ot:' + canal, ...args),
  alEvento: (canal, fn) => { const f = (_e, ...a) => fn(...a); ipcRenderer.on('ev:' + canal, f); return () => ipcRenderer.removeListener('ev:' + canal, f); }
});
