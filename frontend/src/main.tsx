import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
// Imported before App so the locale is resolved and <html lang> is set before
// the first render. Initialising inside a component would paint English first
// and then swap to Chinese, which reads as a broken page rather than a
// deliberate one.
import './i18n';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
