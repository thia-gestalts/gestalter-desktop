const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gestalter', {
  call: async (method, ...args) => {
    const { result, error } = await ipcRenderer.invoke('storage', method, args);
    if (error) throw new Error(error);
    return result;
  },
  onClose: (flush) => {
    const listener = async () => {
      let success = false;
      try {
        success = await flush();
      } finally {
        ipcRenderer.send('close-result', success);
      }
    };
    ipcRenderer.on('flush-for-close', listener);
    return () => ipcRenderer.removeListener('flush-for-close', listener);
  },
});
