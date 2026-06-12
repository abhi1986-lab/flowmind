// Electron preload (context isolation). Expose safe APIs to renderer here in real impl.
// For MVP shell we use data: URL so this is placeholder.
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('flowmind', {
  // Future: secure token get/set, startCapture etc.
});
