// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import './design/app.css';
import { App } from './shell/App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
