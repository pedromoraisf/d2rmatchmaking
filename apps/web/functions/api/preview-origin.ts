// The preview API a Pages preview proxies to (ADR 030). The committed value is `undefined`: production and previews of
// branches without the `render-preview` label use API_ORIGIN. preview-api.yml and deploy-web.yml both run
// `scripts/preview/preview.mjs bake` in their own workspace before `wrangler pages deploy`, which rewrites this line
// when an open pull request into main from the branch carries the label. It is never committed.

// The target (ADR 033, DLP-03) is deploy configuration: the deploy stage writes the origin into preview-origin.json beside
// the Functions before `wrangler pages deploy`, so the built bundle is never patched. The baked line above stays for
// deploy-web.yml, which runs beside the new stages until it is removed (DLP-09).
import deployConfig from './preview-origin.json' with { type: 'json' };

export const PREVIEW_API_ORIGIN: string | undefined = undefined;

const PREVIEW_API_ORIGIN_PATTERN = /^https:\/\/d2rmm-api-pr-[0-9]+\.onrender\.com$/;

/** The origin when it is exactly a Render preview origin, else undefined (the proxy then uses API_ORIGIN). */
export function validPreviewApiOrigin(candidate: string | undefined): string | undefined {
  return candidate !== undefined && PREVIEW_API_ORIGIN_PATTERN.test(candidate) ? candidate : undefined;
}

/** The preview API origin a deploy chose: the baked one wins, then preview-origin.json; invalid values count as none. */
export function previewApiOriginOf(
  baked: string | undefined,
  configured: unknown = deployConfig.previewApiOrigin,
): string | undefined {
  return (
    validPreviewApiOrigin(baked) ??
    validPreviewApiOrigin(typeof configured === 'string' ? configured : undefined)
  );
}
