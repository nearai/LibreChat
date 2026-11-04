import { BADGE_200, badgePath } from '../geometry';

const coordinates = (path: string) => path.replace(/[MLZ]/g, ' ').trim().split(/\s+/).map(Number);

describe('seal geometry', () => {
  it('keeps the badge inside its box', () => {
    const inBox = coordinates(badgePath(8, 8, 7.25));
    expect(Math.min(...inBox)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...inBox)).toBeLessThanOrEqual(16);

    const centred = coordinates(BADGE_200);
    expect(Math.min(...centred)).toBeGreaterThanOrEqual(-100);
    expect(Math.max(...centred)).toBeLessThanOrEqual(100);
  });

  it('draws one closed outline with ten lobes', () => {
    expect(BADGE_200.match(/M/g)).toHaveLength(1);
    expect(BADGE_200.endsWith('Z')).toBe(true);

    const xy = coordinates(BADGE_200);
    const radii: number[] = [];
    for (let i = 0; i + 1 < xy.length; i += 2) {
      radii.push(Math.hypot(xy[i], xy[i + 1]));
    }
    const peaks = radii.filter((radius, i) => {
      const before = radii[(i - 1 + radii.length) % radii.length];
      const after = radii[(i + 1) % radii.length];
      return radius >= before && radius > after;
    });
    expect(peaks).toHaveLength(10);
  });
});
