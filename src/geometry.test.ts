import { describe, expect, it } from 'vitest';
import type { Cuts } from './model';
import {
  chamferCommands,
  chamferPolygon,
  clampCuts,
  commandsSignature,
  extractPolygon,
  mapPointsToBounds,
  polygonCommands,
  sameCommands,
} from './geometry';

const cuts = (tl: number, tr: number, br: number, bl: number): Cuts => ({
  tl,
  tr,
  br,
  bl,
});

const bounds = { x: 10, y: 20, width: 100, height: 60 };

const points = (commands: ReturnType<typeof chamferCommands>) =>
  commands
    .filter(
      (c) =>
        typeof c.params?.x === 'number' && typeof c.params?.y === 'number',
    )
    .map((c) => [c.params?.x, c.params?.y]);

describe('clampCuts', () => {
  it('leaves cuts that fit untouched', () => {
    expect(clampCuts(100, 60, cuts(8, 8, 8, 8))).toEqual({
      tl: 8,
      tr: 8,
      br: 8,
      bl: 8,
    });
  });

  it('scales all cuts down when opposing cuts overlap horizontally', () => {
    // tl+tr = 120 > width 100 -> f = 100/120
    const result = clampCuts(100, 60, cuts(60, 60, 0, 0));
    expect(result.tl).toBeCloseTo(50, 1);
    expect(result.tr).toBeCloseTo(50, 1);
    expect(result.br).toBe(0);
    expect(result.bl).toBe(0);
  });

  it('scales all cuts down when opposing cuts overlap vertically', () => {
    // tr+br = 80 > height 60 -> f = 60/80
    const result = clampCuts(100, 60, cuts(0, 40, 40, 0));
    expect(result.tl).toBe(0);
    expect(result.bl).toBe(0);
    expect(result.tr).toBeCloseTo(30, 1);
    expect(result.br).toBeCloseTo(30, 1);
  });

  it('clamps negative and non-finite cuts to zero', () => {
    expect(clampCuts(100, 60, cuts(-5, Number.NaN, Infinity, 0))).toEqual({
      tl: 0,
      tr: 0,
      br: 0,
      bl: 0,
    });
  });

  it('collapses cuts on degenerate shapes', () => {
    expect(clampCuts(0, 60, cuts(10, 10, 10, 10))).toEqual({
      tl: 0,
      tr: 0,
      br: 0,
      bl: 0,
    });
  });

  it('never scales cuts up', () => {
    expect(clampCuts(1000, 1000, cuts(1, 1, 1, 1))).toEqual({
      tl: 1,
      tr: 1,
      br: 1,
      bl: 1,
    });
  });
});

describe('chamferCommands', () => {
  it('produces move + 7 lines + close = 9 commands', () => {
    const commands = chamferCommands(bounds, cuts(12, 12, 12, 12));
    expect(commands).toHaveLength(9);
    expect(commands[0]?.command).toBe('move-to');
    expect(commands[8]?.command).toBe('close-path');
    expect(commands.slice(1, 8).every((c) => c.command === 'line-to')).toBe(true);
  });

  it('places the 8 points clockwise starting at the top edge', () => {
    const commands = chamferCommands(bounds, cuts(12, 20, 30, 40));
    expect(points(commands)).toEqual([
      [22, 20], // top edge after tl cut
      [90, 20], // top edge before tr cut (110 - 20)
      [110, 40], // right edge after tr cut
      [110, 50], // right edge before br cut (80 - 30)
      [80, 80], // bottom edge before br cut
      [50, 80], // bottom edge after bl cut (10 + 40)
      [10, 40], // left edge before bl cut (80 - 40)
      [10, 32], // left edge after tl cut (20 + 12)
    ]);
  });

  it('keeps bounds when cuts are inside the box', () => {
    const commands = chamferCommands(bounds, cuts(12, 12, 12, 12));
    const xs = commands.map((c) => c.params?.x).filter((v): v is number => v !== undefined);
    const ys = commands.map((c) => c.params?.y).filter((v): v is number => v !== undefined);
    expect(Math.min(...xs)).toBe(bounds.x);
    expect(Math.max(...xs)).toBe(bounds.x + bounds.width);
    expect(Math.min(...ys)).toBe(bounds.y);
    expect(Math.max(...ys)).toBe(bounds.y + bounds.height);
  });

  it('keeps 45 degree chamfers for equal cuts', () => {
    const commands = chamferCommands(bounds, cuts(15, 15, 15, 15));
    // top-left: from (x+15, y) ... last point (x, y+15): both offsets are 15
    expect(commands[0]?.params).toEqual({ x: 25, y: 20 });
    expect(commands[7]?.params).toEqual({ x: 10, y: 35 });
  });

  it('collapses to the plain rectangle when all cuts are zero', () => {
    const commands = chamferCommands(bounds, cuts(0, 0, 0, 0));
    expect(points(commands)).toEqual([
      [10, 20],
      [110, 20],
      [110, 20],
      [110, 80],
      [110, 80],
      [10, 80],
      [10, 80],
      [10, 20],
    ]);
  });
});

describe('signature helpers', () => {
  it('signatures match for identical commands', () => {
    const a = chamferCommands(bounds, cuts(5, 5, 5, 5));
    const b = chamferCommands({ ...bounds }, cuts(5, 5, 5, 5));
    expect(commandsSignature(a)).toBe(commandsSignature(b));
    expect(sameCommands(a, b)).toBe(true);
  });

  it('signatures differ when a point moves', () => {
    const a = chamferCommands(bounds, cuts(5, 5, 5, 5));
    const b = chamferCommands(bounds, cuts(5, 5, 6, 5));
    expect(commandsSignature(a)).not.toBe(commandsSignature(b));
    expect(sameCommands(a, b)).toBe(false);
  });

  it('sameCommands tolerates tiny float noise but not real moves', () => {
    const a = chamferCommands(bounds, cuts(5, 5, 5, 5));
    const b = chamferCommands(
      { ...bounds, x: 10.005 },
      cuts(5, 5, 5, 5),
    );
    expect(sameCommands(a, b)).toBe(true);
    const c = chamferCommands({ ...bounds, x: 12 }, cuts(5, 5, 5, 5));
    expect(sameCommands(a, c)).toBe(false);
  });
});

describe('extractPolygon', () => {
  const line = (x: number, y: number) =>
    ({ command: 'line-to' as const, params: { x, y } }) as const;
  const move = (x: number, y: number) =>
    ({ command: 'move-to' as const, params: { x, y } }) as const;

  it('infers closedness from a point list that returns to the start', () => {
    const result = extractPolygon([
      move(0, 0),
      line(100, 0),
      line(100, 60),
      line(0, 60),
      line(0, 0),
    ]);
    expect(result).toEqual({
      ok: true,
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 60 },
        { x: 0, y: 60 },
      ],
    });
  });

  it('honors an explicit close-path and drops it from the points', () => {
    const result = extractPolygon([
      move(0, 0),
      line(10, 0),
      line(10, 10),
      { command: 'close-path' },
    ]);
    expect(result.ok && result.closed).toBe(true);
    expect(result.ok && result.points).toHaveLength(3);
  });

  it('keeps open polylines open', () => {
    const result = extractPolygon([move(0, 0), line(50, 0), line(50, 50)]);
    expect(result.ok && result.closed).toBe(false);
    expect(result.ok && result.points).toHaveLength(3);
  });

  it('rejects curves', () => {
    const result = extractPolygon([
      move(0, 0),
      {
        command: 'curve-to',
        params: { x: 10, y: 10, c1x: 5, c1y: 0, c2x: 10, c2y: 5 },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('straight lines');
  });

  it('rejects multiple subpaths', () => {
    const result = extractPolygon([move(0, 0), line(10, 0), move(20, 20)]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('multi-part');
  });

  it('skips consecutive duplicate points', () => {
    const result = extractPolygon([
      move(0, 0),
      line(0, 0),
      line(10, 0),
      line(10, 0),
      line(10, 10),
      { command: 'close-path' },
    ]);
    expect(result.ok && result.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });
});

describe('chamferPolygon', () => {
  const pt = (x: number, y: number) => ({ x, y });

  it('chamfers all four corners of a closed square', () => {
    const commands = chamferPolygon(
      [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)],
      true,
      10,
    );
    expect(commands).toHaveLength(9);
    expect(commands[0]?.command).toBe('move-to');
    expect(commands[8]?.command).toBe('close-path');
    const xs = commands
      .slice(0, 8)
      .map((c) => c.params?.x)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(xs).toEqual([0, 0, 10, 10, 90, 90, 100, 100]);
  });

  it('leaves open-path endpoints untouched and chamfers the middle', () => {
    const commands = chamferPolygon(
      [pt(0, 0), pt(50, 0), pt(50, 50)],
      false,
      10,
    );
    expect(commands.map((c) => [c.params?.x, c.params?.y])).toEqual([
      [0, 0],
      [40, 0],
      [50, 10],
      [50, 50],
    ]);
    expect(commands.every((c) => c.command !== 'close-path')).toBe(true);
  });

  it('caps cuts on short edges so neighbouring chamfers never overlap', () => {
    // right edge is only 4 long -> each of its vertices may take at most 2
    const commands = chamferPolygon(
      [pt(0, 0), pt(100, 0), pt(100, 4), pt(0, 10)],
      true,
      50,
    );
    const points = commands
      .filter((c) => c.command !== 'close-path')
      .map((c) => [c.params?.x, c.params?.y]);
    expect(points).toContainEqual([50, 0]); // top edge halved
    expect(points).toContainEqual([100, 2]); // short right edge, both ends capped at 2
    expect(points).toContainEqual([0, 5]); // left edge halved
    // duplicate chamfer points collapse, so 4 corners -> 5 distinct points
    expect(points).toHaveLength(5);
  });

  it('returns the plain polygon when cut is zero', () => {
    const original = [pt(0, 0), pt(10, 0), pt(10, 10)];
    const commands = chamferPolygon(original, true, 0);
    expect(commands).toEqual(polygonCommands(original, true));
  });

  it('stays a valid closed polygon when the cut exceeds every edge', () => {
    // with overtight corners the chamfers meet at the edge midpoints and
    // the triangle collapses to its medial triangle — still valid geometry
    const commands = chamferPolygon(
      [pt(0, 0), pt(20, 0), pt(10, 18)],
      true,
      100,
    );
    expect(commands[0]?.command).toBe('move-to');
    expect(commands[commands.length - 1]?.command).toBe('close-path');
    expect(commands.length).toBeGreaterThanOrEqual(4);
  });
});

describe('mapPointsToBounds', () => {
  it('translates without scaling when only the origin moves', () => {
    const mapped = mapPointsToBounds(
      [
        [10, 10],
        [90, 10],
        [90, 50],
      ],
      { x: 0, y: 0, width: 100, height: 60 },
      { x: 200, y: 100, width: 100, height: 60 },
    );
    expect(mapped).toEqual([
      { x: 210, y: 110 },
      { x: 290, y: 110 },
      { x: 290, y: 150 },
    ]);
  });

  it('scales proportionally on resize', () => {
    const mapped = mapPointsToBounds(
      [
        [0, 0],
        [100, 60],
      ],
      { x: 0, y: 0, width: 100, height: 60 },
      { x: 0, y: 0, width: 200, height: 120 },
    );
    expect(mapped).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 120 },
    ]);
  });
});
