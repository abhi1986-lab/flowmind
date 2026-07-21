// Electron preload (context isolation). Expose safe APIs to renderer here.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('flowmind', {
  onActiveWindowChanged: (callback: (data: any) => void) => {
    ipcRenderer.on('active-window-changed', (_event, data) => callback(data));
  },
  onCaptureTip: (callback: (data: any) => void) => {
    ipcRenderer.on('capture-tip', (_event, data) => callback(data));
  },
  setIntentCapture: (enabled: boolean) => {
    ipcRenderer.send('set-intent-capture', enabled);
  },
  startRecording: (sessionId: string) => {
    ipcRenderer.send('start-recording', sessionId);
  },
  stopRecording: () => {
    ipcRenderer.send('stop-recording');
  },
  apiRequest: (method: string, path: string, body: any = null, authToken: string | null = null) =>
    ipcRenderer.invoke('api-request', { method, path, body, authToken }),
});
