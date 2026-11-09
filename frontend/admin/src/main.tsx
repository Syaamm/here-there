import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
import './styles.css';
import './motion.css';
import './controls.css'; // the console's own dropdown and date picker
import './responsive.css'; // last: the small-screen layout and the collapsible sidebar win over the older rules

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
// the console started: the page's own "it never started" guard (index.html) can stand down
try {
  sessionStorage.removeItem('ht_admin_boot_reload');
} catch {
  /* storage unavailable */
}
