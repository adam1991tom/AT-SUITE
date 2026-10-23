const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("setup", {
  prefill: () => ipcRenderer.invoke("setup:prefill"),
  enrol: (form) => ipcRenderer.invoke("setup:enrol", form),
  // An admin of the server signs in instead of typing the code (and always to change server).
  enrolAdmin: (form) => ipcRenderer.invoke("setup:enrol-admin", form),
  cancel: () => ipcRenderer.invoke("setup:cancel"),
});
