import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './legacy.css';
import './design-tokens.css';
import './react-shell.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Élément racine React introuvable.');
}

createRoot(rootElement).render(
  <StrictMode>
    {/* Last resort: the views and dialogs have their own boundaries inside App. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
