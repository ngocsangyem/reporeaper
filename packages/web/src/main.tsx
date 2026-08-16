import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import './index.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
