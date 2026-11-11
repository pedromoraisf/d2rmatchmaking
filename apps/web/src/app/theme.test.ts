// SHL-01: every text colour meets WCAG AA on each surface it sits on (4.5:1), and every control boundary meets 3:1
// (NFR-13). The colours are read from theme.css itself, so a token change that breaks a pair fails here.
import { describe, expect, it } from 'vitest';
import themeCss from './theme.css?raw';

/** The `--name: #rrggbb` declarations of the stylesheet, by token name. */
function tokens(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    found.set(match[1] ?? '', match[2] ?? '');
  }
  return found;
}

/** WCAG relative luminance of an sRGB hex colour. */
function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

/** WCAG contrast ratio of two hex colours, from 1 to 21. */
function contrastRatio(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const TEXT_MIN = 4.5;
const CONTROL_MIN = 3;

// Each text token with the surfaces it is written on. The page surfaces are the header, the panels and the stone.
const PAGE_SURFACES = ['abyss', 'panel-hi', 'panel', 'panel-lo', 'panel-2'] as const;
const TEXT_PAIRS: readonly { text: string; surfaces: readonly string[]; min: number }[] = [
  ...['parch', 'ash', 'gold', 'gold-dim', 'ok', 'warn', 'bad', 'd-n', 'd-nm', 'd-h'].map((text) => ({
    text,
    surfaces: PAGE_SURFACES,
    min: TEXT_MIN,
  })),
  { text: 'btn-text', surfaces: ['blood-hi', 'blood-lo'], min: TEXT_MIN },
  { text: 'abyss', surfaces: ['gold'], min: TEXT_MIN },
];

// Control boundaries and focus rings: the outline of a button or input must stand out from the surface behind it.
const CONTROL_PAIRS: readonly { part: string; surfaces: readonly string[] }[] = [
  { part: 'line-2', surfaces: PAGE_SURFACES },
  { part: 'gold', surfaces: ['abyss', 'panel-lo'] },
];

describe('theme tokens', () => {
  const colours = tokens(themeCss);

  it('defines every colour the pairs test', () => {
    const named = [
      ...TEXT_PAIRS.flatMap((pair) => [pair.text, ...pair.surfaces]),
      ...CONTROL_PAIRS.flatMap((pair) => [pair.part, ...pair.surfaces]),
    ];
    for (const name of named) {
      expect(colours.get(name), `--${name}`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it.each(
    TEXT_PAIRS.flatMap((pair) => pair.surfaces.map((surface) => [pair.text, surface, pair.min] as const)),
  )('text --%s on --%s meets %s:1', (text, surface, min) => {
    const ratio = contrastRatio(colours.get(text) ?? '', colours.get(surface) ?? '');
    expect(ratio, `--${text} on --${surface}`).toBeGreaterThanOrEqual(min);
  });

  it.each(CONTROL_PAIRS.flatMap((pair) => pair.surfaces.map((surface) => [pair.part, surface] as const)))(
    'control --%s on --%s meets 3:1',
    (part, surface) => {
      const ratio = contrastRatio(colours.get(part) ?? '', colours.get(surface) ?? '');
      expect(ratio, `--${part} on --${surface}`).toBeGreaterThanOrEqual(CONTROL_MIN);
    },
  );

  it('keeps the page on the dark stone, with the prototype fonts', () => {
    expect(themeCss).toContain("--display: 'Cinzel'");
    expect(themeCss).toContain("--body: 'Alegreya Sans'");
    expect(themeCss).toContain("--mono: 'IBM Plex Mono'");
  });
});
