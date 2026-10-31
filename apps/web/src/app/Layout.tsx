// The frame of every page: the title, the download link for the agent and the non-affiliation notice (AWS-17, AWS-38).
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export const AGENT_DOWNLOAD_URL =
  'https://github.com/pedromoraisf/d2rmatchmaking/releases/latest/download/D2RMatchMaking-setup.exe';

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <header>
        <h1>{t('app.title')}</h1>
        <a href={AGENT_DOWNLOAD_URL}>{t('app.downloadAgent')}</a>
      </header>
      <main>{children}</main>
      <footer>
        <p>{t('app.notice')}</p>
      </footer>
    </>
  );
}
