/**
 * Geometry for the proof seal. The badge outline is the same everywhere; the woven
 * strands around it are drawn from the signing key the checks verified, so a different
 * key draws a visibly different seal and a copied icon cannot pass for it.
 */

const TAU = Math.PI * 2;

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** The check drawn inside the badge, in its 16-unit box. */
export const CHECK_PATH = 'M5.6 8.1 7.3 9.8 10.5 6.4';

/**
 * The ten-lobed badge: round lobes with a notch at the top, `r` its mean radius.
 * The shape does not depend on the key, so it reads as one mark at every size.
 */
export function badgePath(cx: number, cy: number, r: number, steps = 180): string {
  let d = '';
  for (let s = 0; s < steps; s++) {
    const t = (s / steps) * TAU;
    const radius =
      r * (1 + 0.05394 * Math.cos(10 * t - Math.PI) + 0.0019 * Math.cos(20 * t + 0.064));
    d += `${s ? 'L' : 'M'}${round2(cx + radius * Math.sin(t))} ${round2(cy - radius * Math.cos(t))}`;
  }
  return `${d}Z`;
}

/** The badge in a 16-unit box, for the glyph inside a seal. */
export const BADGE_16 = badgePath(8, 8, 7.25);
/** The badge in a 200-unit box centred on the origin, for pills and tags. */
export const BADGE_200 = badgePath(0, 0, 90.4);

/** Hex digits of a signing key or address, lower case and without a `0x` prefix. */
export function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/^0x/, '')
    .replace(/[^0-9a-f]/g, '');
}

/** The code printed beside a seal: the key's first and last four hex digits. */
export function sealCode(key: string): string {
  const hex = normalizeKey(key);
  return `${hex.slice(0, 4)}·${hex.slice(-4)}`.toUpperCase();
}

export type SealStrands = {
  /** Two woven bands near the rim. */
  band: string;
  /** Three rose petals inside them. */
  rose: string;
};

/** The fewest key bytes the strands read from. Ed25519 keys carry 32, ECDSA addresses 20. */
const MIN_KEY_BYTES = 10;

const strandCache = new Map<string, SealStrands>();

/**
 * Strands for the seal in a 200-unit box centred on the origin. Each key byte picks
 * a lobe count, an amplitude or a phase, so equal keys always draw equal seals.
 * Returns `undefined` for a value too short to be a key.
 */
export function sealStrands(key: string): SealStrands | undefined {
  const hex = normalizeKey(key);
  const cached = strandCache.get(hex);
  if (cached) {
    return cached;
  }
  const bytes: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  if (bytes.length < MIN_KEY_BYTES) {
    return undefined;
  }

  const pick = (i: number, lo: number, hi: number) => lo + (bytes[i] % (hi - lo + 1));
  const curve = (radius: (t: number) => number, steps: number) => {
    let d = '';
    for (let s = 0; s < steps; s++) {
      const t = (s / steps) * TAU;
      const r = radius(t);
      d += `${s ? 'L' : 'M'}${round1(r * Math.sin(t))} ${round1(-r * Math.cos(t))}`;
    }
    return `${d}Z`;
  };

  const bandLobes = pick(0, 14, 20);
  const bandAmp = pick(1, 40, 55) / 10;
  const bandPhase = (bytes[2] / 255) * TAU;
  const roseLobes = pick(3, 5, 9);
  const roseWave = pick(4, 2, 4);
  const roseAmp = pick(5, 120, 160) / 10;
  const rosePhase = (bytes[6] / 255) * TAU;

  let band = '';
  for (let j = 0; j < 2; j++) {
    band += curve((t) => 84 + bandAmp * Math.sin(bandLobes * t + bandPhase + (j * TAU) / 2), 240);
  }
  let rose = '';
  for (let j = 0; j < 3; j++) {
    const turn = (j * TAU) / (roseLobes * 3);
    rose += curve(
      (t) =>
        58 +
        roseAmp *
          Math.sin(roseLobes * (t + turn)) *
          (0.65 + 0.35 * Math.cos(roseWave * t + rosePhase)),
      240,
    );
  }

  const strands = { band, rose };
  strandCache.set(hex, strands);
  return strands;
}
