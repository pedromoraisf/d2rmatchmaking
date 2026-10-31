// Renders a component under a fresh i18n instance for the given browser languages (AD-040).
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '../app/i18n.ts';

export function renderInLanguage(ui: ReactElement, languages: readonly string[] = ['en-US']): RenderResult {
  return render(<I18nextProvider i18n={createI18n(languages)}>{ui}</I18nextProvider>);
}
