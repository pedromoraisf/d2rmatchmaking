// The code signing policy (AGR-08): the page SignPath Foundation asks a project to publish. It needs no sign-in and no API.
import { useTranslation } from 'react-i18next';
import { REPOSITORY_URL, SIGNING_ROLES } from './signing-policy.ts';

export function CodeSigningPage() {
  const { t } = useTranslation();
  return (
    <article className="stack" aria-labelledby="signing-title">
      <h2 id="signing-title">{t('signing.title')}</h2>
      <p>{t('signing.project')}</p>
      <p>{t('signing.provider')}</p>

      <section aria-labelledby="signing-roles">
        <h3 id="signing-roles">{t('signing.rolesTitle')}</h3>
        <p>{t('signing.rolesIntro')}</p>
        <ul>
          {SIGNING_ROLES.map(({ role, handle }) => (
            <li key={role}>
              {t(`signing.roles.${role}`)}: <a href={`https://github.com/${handle}`}>@{handle}</a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="signing-program">
        <h3 id="signing-program">{t('signing.programTitle')}</h3>
        <p>{t('signing.program')}</p>
      </section>

      <section aria-labelledby="signing-privacy">
        <h3 id="signing-privacy">{t('signing.privacyTitle')}</h3>
        <p>{t('signing.privacyRule')}</p>
        <p>{t('signing.privacyData')}</p>
      </section>

      <p>
        <a href={REPOSITORY_URL}>{t('signing.source')}</a> ·{' '}
        <a href={`${REPOSITORY_URL}/issues`}>{t('signing.contact')}</a>
      </p>
    </article>
  );
}
