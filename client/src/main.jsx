import { Buffer } from 'buffer';
window.Buffer = Buffer;
// Safely polyfill process and bind setTimeout to the window
window.process = {
  env: {},
  version: '',
  nextTick: (cb) => window.setTimeout(cb, 0)
};

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import 'bootstrap/dist/css/bootstrap.min.css'; // Minimal, clean UI framework

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);