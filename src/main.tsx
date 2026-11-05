import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { installPress } from './ui/press';
import BusyOverlay from './ui/BusyOverlay';
import SuperApprovalHost from './ui/SuperApproval';

// open the app even with no internet (production build only; the dev server must not be cached)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* app still works online */ }); });
}

installPress();

createRoot(document.getElementById('root')!).render(<StrictMode><App /><SuperApprovalHost /><BusyOverlay /></StrictMode>);
