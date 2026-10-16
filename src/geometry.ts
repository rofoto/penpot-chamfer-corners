import type { Path } from '@penpot/plugin-types';
import type { Cuts } from './model';

export type PathCommand = Path['commands'][number];

export interface ChamferBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EPS = 1e-6;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Clamps per-corner cut distances so adjacent cuts never overlap,
 * using the same proportional scaling idea as Penpot's fix-radius:
 * one factor for all cuts, so chamfer angles stay consistent.
 */
export function clampCuts(width: number, height: number, cuts: Cuts): Cuts {
  const norm = (v: number): number =>
    Number.isFinite(v) && v > 0 ? v : 0;

  const tl = norm(cuts.tl);
  const tr = norm(cuts.tr);
  const br = norm(cuts.br);
  const bl = norm(cuts.bl);

  const ratio = (sum: number, edge: number): number =>
    sum > EPS ? edge / sum : Infinity;

  const f = Math.min(
    1,
    ratio(tl + tr, width),
    ratio(bl + br, width),
    ratio(tl + bl, height),
    ratio(tr + br, height),
  );

  return { tl: round2(tl * f), tr: round2(tr * f), br: round2(br * f), bl: round2(bl * f) };
}

/**
 * Builds the 8-point chamfer polygon for a bounding box in absolute
 * page coordinates, clockwise from the top edge.
 */
export function chamferCommands(
  bounds: ChamferBounds,
  cuts: Cuts,
): PathCommand[] {
  const c = clampCuts(bounds.width, bounds.height, cuts);
  const { x, y } = bounds;
  const x2 = x + bounds.width;
  const y2 = y + bounds.height;

  const points: Array<[number, number]> = [
    [x + c.tl, y],
    [x2 - c.tr, y],
    [x2, y + c.tr],
    [x2, y2 - c.br],
    [x2 - c.br, y2],
    [x + c.bl, y2],
    [x, y2 - c.bl],
    [x, y + c.tl],
  ];

  const [first, ...rest] = points;
  if (!first) {
    return [];
  }

  return [
    { command: 'move-to', params: { x: first[0], y: first[1] } },
    ...rest.map(([px, py]): PathCommand => ({
      command: 'line-to',
      params: { x: px, y: py },
    })),
    { command: 'close-path' },
  ];
}

/**
 * Stable signature of a command list, used to detect writes done by
 * the plugin versus edits done by hand with the pen tools.
 */
export function commandsSignature(commands: PathCommand[]): string {
  return JSON.stringify(
    commands.map((cmd) => [cmd.command, cmd.params?.x ?? null, cmd.params?.y ?? null]),
  );
}

export function sameCommands(
  a: PathCommand[],
  b: PathCommand[],
  epsilon = 0.01,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ca = a[i];
    const cb = b[i];
    if (!ca || !cb) return false;
    if (ca.command !== cb.command) return false;
    const pa = ca.params ?? {};
    const pb = cb.params ?? {};
    for (const key of ['x', 'y', 'c1x', 'c1y', 'c2x', 'c2y', 'rx', 'ry'] as const) {
      const va = pa[key];
      const vb = pb[key];
      if (va === undefined && vb === undefined) continue;
      if (va === undefined || vb === undefined) return false;
      if (Math.abs(va - vb) > epsilon) return false;
    }
  }
  return true;
}
