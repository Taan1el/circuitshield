import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/work-sans';
import '@fontsource-variable/martian-mono';
import './styles/tokens.css';
import App from './App.js';
import { registerOffline } from './local/offline.js';
import { UpdateNotice } from './local/UpdateNotice.js';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UpdateNotice />
    <App />
  </React.StrictMode>
);

registerOffline();
