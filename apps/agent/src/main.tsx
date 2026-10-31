import { createRoot } from 'react-dom/client';
import { createAgentI18n } from './shared/i18n.ts';
import { agentLanguage } from './shared/language.ts';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html has no #root element');
}

const i18n = createAgentI18n(agentLanguage(navigator.language));
document.documentElement.lang = i18n.language;
createRoot(container).render(<h1>{i18n.t('app.title')}</h1>);
