// The site language (AD-040): pt-BR when the browser's first preferred language starts with `pt`, English otherwise.
export type SiteLanguage = 'en' | 'pt-BR';

export function siteLanguage(preferred: readonly string[] | undefined): SiteLanguage {
  const first = preferred?.[0];
  return first !== undefined && first.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}
