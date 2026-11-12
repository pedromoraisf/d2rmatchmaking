// The preview API a Pages preview proxies to (ADR 030). The committed value is `undefined`: production and the staging
// previews use API_ORIGIN. preview-api.yml overwrites this file in its own workspace, before `wrangler pages deploy`,
// with the preview API of the pull request; it is never committed.

export interface PreviewApi {
  /** `https://d2rmm-api-pr-<digits>.onrender.com`. */
  readonly origin: string;
  /** The origin the preview API accepts in `Origin` (its SITE_ORIGIN, inherited from the base service). */
  readonly siteOrigin: string;
}

export const PREVIEW_API: PreviewApi | undefined = undefined;

const PREVIEW_API_ORIGIN = /^https:\/\/d2rmm-api-pr-[0-9]+\.onrender\.com$/;
const SITE_ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]+)?$/;

/** The preview API when both of its origins are well formed, else undefined (the proxy then uses API_ORIGIN). */
export function validPreviewApi(candidate: PreviewApi | undefined): PreviewApi | undefined {
  if (candidate === undefined) {
    return undefined;
  }
  return PREVIEW_API_ORIGIN.test(candidate.origin) && SITE_ORIGIN.test(candidate.siteOrigin)
    ? candidate
    : undefined;
}
