// Creates the i18next instance for the agent window (AGS-31, AGS-32). The language comes from the Windows display
// language, decided once by agentLanguage.
import i18next, { type i18n as I18n } from 'i18next';
import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';
import type { AgentLanguage } from './language.ts';
import type { Translate } from './labels.ts';

export function createAgentI18n(language: AgentLanguage): I18n {
  const instance = i18next.createInstance();
  void instance.init({
    lng: language,
    fallbackLng: 'en',
    resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}

// The view layer's translate function over one instance (views take a function, not the instance).
export function translatorFor(instance: I18n): Translate {
  return (key, values) => String(instance.t(key, values ?? {}));
}
