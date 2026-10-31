// Creates the i18next instance for one page load (NFR-12). The language follows the browser's preferred languages.
import i18next, { type i18n as I18n } from 'i18next';
import en from '../shared/locales/en.json';
import ptBR from '../shared/locales/pt-BR.json';
import { siteLanguage } from '../shared/language.ts';

export function createI18n(preferred: readonly string[] | undefined): I18n {
  const instance = i18next.createInstance();
  void instance.init({
    lng: siteLanguage(preferred),
    fallbackLng: 'en',
    resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}
