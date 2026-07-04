// Electron preload (context isolation). Expose safe APIs to renderer here.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('flowmind', {
  onActiveWindowChanged: (callback: (data: any) => void) => {
    ipcRenderer.on('active-window-changed', (event, data) => callback(data));
  },
  startRecording: (sessionId: string) => {
    ipcRenderer.send('start-recording', sessionId);
  },
  stopRecording: () => {
    ipcRenderer.send('stop-recording');
  },
  apiRequest: (method: string, path: string, body: any = null, authToken: string | null = null) =>
    ipcRenderer.invoke('api-request', { method, path, body, authToken })
});
