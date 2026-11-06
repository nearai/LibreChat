import { BADGE_200, SEAL_BAND, SEAL_ROSE, badgePath } from '../geometry';

const coordinates = (path: string) => path.replace(/[MLZ]/g, ' ').trim().split(/\s+/).map(Number);

const radii = (path: string) => {
  const xy = coordinates(path);
  const distances: number[] = [];
  for (let i = 0; i + 1 < xy.length; i += 2) {
    distances.push(Math.hypot(xy[i], xy[i + 1]));
  }
  return distances;
};

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

    const outline = radii(BADGE_200);
    const peaks = outline.filter((radius, i) => {
      const before = outline[(i - 1 + outline.length) % outline.length];
      const after = outline[(i + 1) % outline.length];
      return radius >= before && radius > after;
    });
    expect(peaks).toHaveLength(10);
  });

  it('weaves two closed bands and three closed petals', () => {
    expect(SEAL_BAND.match(/M/g)).toHaveLength(2);
    expect(SEAL_BAND.match(/Z/g)).toHaveLength(2);
    expect(SEAL_ROSE.match(/M/g)).toHaveLength(3);
    expect(SEAL_ROSE.match(/Z/g)).toHaveLength(3);
  });

  it('keeps the strands in their box and clear of the badge at the center', () => {
    /** SealMark draws the badge at 0.4 of its size inside the strands. */
    const badgeEdge = Math.max(...radii(BADGE_200)) * 0.4;

    expect(Math.max(...radii(SEAL_BAND))).toBeLessThanOrEqual(100);
    expect(Math.min(...radii(SEAL_BAND))).toBeGreaterThan(Math.max(...radii(SEAL_ROSE)));
    expect(Math.min(...radii(SEAL_ROSE))).toBeGreaterThan(badgeEdge);
  });
});
