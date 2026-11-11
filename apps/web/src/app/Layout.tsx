// The frame of every page (SHL-02, SHL-03, SHL-05, SHL-06): a sticky header with the brand, the sections that exist, the
// agent's state and the account (or the sign-in controls); a main column; a status column with the agent panel and the
// agent download (AWS-17, AWS-38); and the footer with the non-affiliation notice.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export const AGENT_DOWNLOAD_URL =
  'https://github.com/pedromoraisf/d2rmatchmaking/releases/latest/download/D2RMatchMaking-setup.exe';

export interface LayoutProps {
  /** The main column: the player's content. */
  children: ReactNode;
  /** The header's agent state; null when signed out. */
  agent?: ReactNode;
  /** The header's account, or the sign-in controls when signed out. */
  account?: ReactNode;
  /** The status column's agent panel; null when there is none to show. */
  status?: ReactNode;
}

export function Layout({ children, agent = null, account = null, status = null }: LayoutProps) {
  const { t } = useTranslation();
  return (
    <>
      <header className="top">
        <div className="top-in">
          <div className="brand">
            <svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
              <path d="M20 2 L36 20 L20 38 L4 20 Z" fill="none" stroke="#d6b46c" strokeWidth="1.4" />
              <path d="M20 9 L29 20 L20 31 L11 20 Z" fill="#a3231a" stroke="#d6b46c" strokeWidth="1" />
              <path d="M20 13 V27 M14.5 20 H25.5" stroke="#f3d79a" strokeWidth="1.4" />
            </svg>
            <h1>{t('app.title')}</h1>
          </div>
          <nav className="nav" aria-label={t('nav.label')}>
            <a href="/" aria-current="page">
              {t('nav.play')}
            </a>
          </nav>
          <div className="account">
            {agent}
            {account}
          </div>
        </div>
      </header>
      <div className="wrap play">
        <main className="stack">{children}</main>
        <aside className="side" aria-label={t('status.label')}>
          {status !== null ? <section className="panel">{status}</section> : null}
          <section className="panel">
            <p>
              <a href={AGENT_DOWNLOAD_URL}>{t('app.downloadAgent')}</a>{' '}
              <span className="muted">{t('app.smartScreenNote')}</span>
            </p>
          </section>
        </aside>
      </div>
      <footer className="foot">
        <p>{t('app.notice')}</p>
      </footer>
    </>
  );
}
