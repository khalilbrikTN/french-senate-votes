import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './legacy.css';
import './design-tokens.css';
import './react-shell.css';
import App from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Élément racine React introuvable.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
