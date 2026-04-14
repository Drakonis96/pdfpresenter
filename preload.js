const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPresentations: () => ipcRenderer.invoke('get-presentations'),
  savePresentationsMeta: (data) => ipcRenderer.invoke('save-presentations-meta', data),
  importPdf: () => ipcRenderer.invoke('import-pdf'),
  importPptxNotes: (pdfId) => ipcRenderer.invoke('import-pptx-notes', pdfId),
  getPdfData: (pdfId) => ipcRenderer.invoke('get-pdf-data', pdfId),
  startPresentation: (pdfId) => ipcRenderer.invoke('start-presentation', pdfId),
  startPresenterMode: (pdfId) => ipcRenderer.invoke('start-presenter-mode', pdfId),
  stopPresentation: () => ipcRenderer.invoke('stop-presentation'),
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  deletePresentation: (pdfId) => ipcRenderer.invoke('delete-presentation', pdfId),
  
  // Presentation control
  sendPresentationControl: (action) => ipcRenderer.send('presentation-control', action),
  onPresentationControl: (callback) => ipcRenderer.on('presentation-control', (_, action) => callback(action)),
  
  // Presenter control (from presenter view to audience)
  sendPresenterControl: (action) => ipcRenderer.send('presenter-control', action),
  
  // State updates
  sendStateUpdate: (state) => ipcRenderer.send('presentation-state-update', state),
  onStateUpdate: (callback) => ipcRenderer.on('presentation-state-update', (_, state) => callback(state)),
  onPresentationEnded: (callback) => ipcRenderer.on('presentation-ended', () => callback()),

  // Get URL query params
  getQueryParams: () => {
    const params = new URLSearchParams(window.location.search);
    return Object.fromEntries(params.entries());
  }
});
