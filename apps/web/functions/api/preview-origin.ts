// The preview API a Pages preview proxies to (ADR 030). The committed value is `undefined`: production and previews of
// branches without the `render-preview` label use API_ORIGIN. preview-api.yml and deploy-web.yml both run
// `scripts/preview/preview.mjs bake` in their own workspace before `wrangler pages deploy`, which rewrites this line
// when an open pull request into main from the branch carries the label. It is never committed.

export const PREVIEW_API_ORIGIN: string | undefined = undefined;

const PREVIEW_API_ORIGIN_PATTERN = /^https:\/\/d2rmm-api-pr-[0-9]+\.onrender\.com$/;

/** The origin when it is exactly a Render preview origin, else undefined (the proxy then uses API_ORIGIN). */
export function validPreviewApiOrigin(candidate: string | undefined): string | undefined {
  return candidate !== undefined && PREVIEW_API_ORIGIN_PATTERN.test(candidate) ? candidate : undefined;
}
