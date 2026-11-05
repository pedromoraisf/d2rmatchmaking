// The agent window language (AD-054): pt-BR when the Windows display language starts with `pt`, English otherwise.
// WebView2 reports the Windows display language as `navigator.language`.
export type AgentLanguage = 'en' | 'pt-BR';

export function agentLanguage(displayLanguage: string): AgentLanguage {
  return displayLanguage.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}
