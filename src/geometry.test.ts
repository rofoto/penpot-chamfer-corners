import { describe, expect, it } from 'vitest';
import type { Cuts } from './model';
import {
  chamferCommands,
  clampCuts,
  commandsSignature,
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
