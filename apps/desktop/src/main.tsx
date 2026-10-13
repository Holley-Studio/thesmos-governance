// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import './design/app.css';
import './design/studio.css';
import './design/chat.css';
import './design/today.css';
import './design/finance.css';
import '@fontsource/cinzel/latin-400.css';
import { App } from './shell/StudioApp';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
