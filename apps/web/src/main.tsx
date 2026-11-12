import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { App } from './app/App.tsx';
import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/500.css';
import '@fontsource/alegreya-sans/700.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './app/theme.css';
import { createI18n } from './app/i18n.ts';
import { startSiteTelemetry } from './shared/telemetry.ts';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html has no #root element');
}

// Telemetry starts before the first render, and only in the builds that turn it on (OBS-44).
startSiteTelemetry(import.meta.env, window);

const i18n = createI18n(navigator.languages);
document.documentElement.lang = i18n.language;
createRoot(container).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  </StrictMode>,
);
