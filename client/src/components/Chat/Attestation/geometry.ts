/**
 * Geometry for the proof seal: one fixed 10-point badge at every size. The seal marks the
 * status beside it. The checks are the proof, so it takes a status and never a key.
 */

const TAU = Math.PI * 2;

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Glyphs drawn inside the badge, in its 16-unit box. */
export const CHECK_PATH = 'M5.6 8.1 7.3 9.8 10.5 6.4';
export const CROSS_PATH = 'M5.5 5.5l5 5M10.5 5.5l-5 5';
export const CLOCK_PATH = 'M11.6 8a3.6 3.6 0 1 1-7.2 0a3.6 3.6 0 1 1 7.2 0ZM8 5.9v2.2l1.4 1';
export const PENCIL_PATH = 'M5.5 10.5 6 8.6 9.4 5.2 10.8 6.6 7.4 10Z';
export const DASH_PATH = 'M5 8h6';

/** The ten-lobed badge: round lobes with a notch at the top, `r` its mean radius. */
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

/** The badge in a 200-unit box centred on the origin. */
export const BADGE_200 = badgePath(0, 0, 90.4);

/** A closed curve around the origin, with `radius` giving its distance at each angle. */
function polarCurve(radius: (t: number) => number, steps = 240): string {
  let d = '';
  for (let s = 0; s < steps; s++) {
    const t = (s / steps) * TAU;
    const r = radius(t);
    d += `${s ? 'L' : 'M'}${round1(r * Math.sin(t))} ${round1(-r * Math.cos(t))}`;
  }
  return `${d}Z`;
}

/*
 * The detail around the badge at 48-64 px, in the same 200-unit box. It is fixed artwork,
 * the same for every deployment, so it identifies nothing and needs no key.
 */

/** Two woven bands near the rim. */
export const SEAL_BAND = [0, 1]
  .map((j) => polarCurve((t) => 84 + 4.2 * Math.sin(20 * t + 0.394 + j * Math.PI)))
  .join('');

/** Three rose petals inside the bands, clear of the badge at the center. */
export const SEAL_ROSE = [0, 1, 2]
  .map((j) => {
    const turn = (j * TAU) / 21;
    return polarCurve(
      (t) => 58 + 12.3 * Math.sin(7 * (t + turn)) * (0.65 + 0.35 * Math.cos(4 * t + 2.981)),
    );
  })
  .join('');
