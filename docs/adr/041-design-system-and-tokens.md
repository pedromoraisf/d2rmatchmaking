# ADR 041 — Design system and tokens in `apps/web`

**Status**: Proposed
**Date**: 2026-11-28
**Deciders**: maintainer
**Supersedes**: none

## Context

The interface built through F2 validated the idea and has no visual system. On 2026-11-28 the maintainer approved the
identity of `docs/product/direction-2026-11.md` (AD-185): ground `#070504`, panel `#110D0A`, bronze `#6B5230`, gold
`#E3B866`, bone `#EFE6D2`, blood `#C8281E`, ember `#FF6A2B`, verified green `#7BD88F`; Cinzel for display, Alegreya
Sans for body, Saira Condensed for numbers and tags; a mascot drawn as a sticker; chamfered buttons and framed panels.
The reference is a design canvas of eight artboards written as inline-styled HTML; its source is recorded in
`docs/design/canvas/project/`.

The forces: NFR-13 (keyboard and AA contrast), NFR-12 and rule 9 (no hard-coded strings), NFR-07 (free tiers, no paid
font or asset service), "no Blizzard logos or assets" (PRD, AGENTS.md), and the desktop agent's window, a second
React UI that should look like the site.

## Decision

1. **Tokens are CSS custom properties** in one file, `apps/web/src/shared/design/tokens.css`: colour, type scale,
   spacing, radius, border and motion. Components use tokens only; a raw colour or font name outside the tokens file
   fails a lint rule. One dark theme; no light theme in the MVP.
2. **Fonts are self-hosted** `woff2` files of the three families (all SIL Open Font License), committed under
   `apps/web/public/fonts` with their licence files, subset to Latin. No request to a font CDN: the site makes no
   third-party request (privacy, and the Pages proxy keeps one origin, ADR 012).
3. **Components live in `apps/web/src/shared/ui`**, plain React with CSS modules, no component library and no CSS
   framework: button (primary gold, accept blood, ghost), framed panel, chip, switch, status dot, tag, party pips,
   table row, dialog, page shell with the header. Each is keyboard-operable and has its contrast checked by a test
   over the token pairs it uses (AA: 4.5:1 for text, 3:1 for large text and marks).
4. **The canvas is the visual reference, not source.** Each feature's spec names its artboard; workers rebuild the
   screen with tokens and components and never paste the canvas's inline styles. Where the canvas and a requirement
   disagree, the requirement wins and the difference is written in the PR.
5. **The agent window uses the same tokens** through a small shared package (`packages/design-tokens`: the CSS file
   and the font files), so the two UIs cannot drift. Its redesign is a feature of its own.
6. **Brand assets**: the mascot and logo are the project's own drawings; their vector masters are in
   `docs/brand/logo/svg` and the site and the agent build their images from those. No Blizzard logo, font or game art
   is used; the hero is original art, and the three canvas assets made from official class art
   (`docs/design/README.md`) never enter the repository or the site.
7. **Every string stays in the translation files** (English source, pt-BR), display capitals are applied by CSS, not
   typed in capitals.

## Alternatives considered

- **Tailwind or another utility framework.** Fast to match the canvas, but it adds a build dependency and puts design
  values in class names across every component. Rejected for a system of about a dozen components.
- **A component library (Radix themes, MUI, shadcn).** Rejected as a whole: the look is custom. Unstyled accessible
  primitives may be adopted per component in a feature's design when a dialog or a switch needs them.
- **Google Fonts by link**, as the canvas does. Rejected: a third-party request on every page view.
- **Tokens as TypeScript constants.** Rejected: CSS properties work in the agent window and in plain CSS with no
  runtime.

## Consequences

- Every screen built before F3 is restyled; the F3 features that touch a screen carry its restyle.
- A lint rule and contrast tests are new sensors; they are added, not relaxed (rule 4).
- The font files add about 300 kB to the repository once.
- `packages/design-tokens` is a new workspace; dependency rules gain one leaf package.
- Revisit if a light theme or a second brand is ever needed.
