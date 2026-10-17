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

/* ------------------------------------------------------------------ */
/* Arbitrary straight-line paths                                       */
/* ------------------------------------------------------------------ */

export interface PolyPoint {
  x: number;
  y: number;
}

export type ExtractPolygonResult =
  | { ok: true; points: PolyPoint[]; closed: boolean }
  | { ok: false; error: string };

const POINT_EPS = 0.01;

const samePoint = (a: PolyPoint, b: PolyPoint): boolean =>
  Math.abs(a.x - b.x) <= POINT_EPS && Math.abs(a.y - b.y) <= POINT_EPS;

/**
 * Parses a command list into a straight-line polygon.
 * Rejects curves, arcs, multiple subpaths and other command types.
 * Closedness comes from a trailing close-path or from the last point
 * coinciding with the first.
 */
export function extractPolygon(commands: PathCommand[]): ExtractPolygonResult {
  if (commands.length < 2) {
    return { ok: false, error: 'path is empty or a single point' };
  }
  const first = commands[0];
  if (
    !first ||
    first.command !== 'move-to' ||
    first.params?.x === undefined ||
    first.params?.y === undefined
  ) {
    return { ok: false, error: 'path does not start with a move-to' };
  }
  const points: PolyPoint[] = [{ x: first.params.x, y: first.params.y }];
  let closed = false;

  for (let i = 1; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd) continue;
    if (cmd.command === 'close-path') {
      if (i !== commands.length - 1) {
        return { ok: false, error: 'close-path appears before the end of the path' };
      }
      closed = true;
      continue;
    }
    if (closed) {
      return { ok: false, error: 'path has commands after close-path' };
    }
    if (cmd.command === 'move-to') {
      return {
        ok: false,
        error: "multi-part paths (several subpaths) aren't supported",
      };
    }
    if (
      cmd.command !== 'line-to' ||
      cmd.params?.x === undefined ||
      cmd.params?.y === undefined
    ) {
      return {
        ok: false,
        error: `“${cmd.command}” segments aren't supported — only straight lines`,
      };
    }
    const p = { x: cmd.params.x, y: cmd.params.y };
    const last = points[points.length - 1];
    if (last && !samePoint(last, p)) {
      points.push(p);
    }
  }

  const head = points[0];
  const tail = points[points.length - 1];
  if (!closed && head && tail && samePoint(head, tail)) {
    closed = true;
    points.pop();
  }
  if (points.length < 2) {
    return { ok: false, error: 'path has fewer than 2 distinct points' };
  }
  if (closed && points.length < 3) {
    return { ok: false, error: 'a closed path needs at least 3 points' };
  }
  return { ok: true, points, closed };
}

/**
 * Rebuilds plain polygon commands from points (used to restore originals).
 */
export function polygonCommands(
  points: PolyPoint[],
  closed: boolean,
): PathCommand[] {
  const [head, ...tail] = points;
  if (!head) return [];
  return [
    { command: 'move-to', params: { x: head.x, y: head.y } },
    ...tail.map(
      (p): PathCommand => ({ command: 'line-to', params: { x: p.x, y: p.y } }),
    ),
    ...(closed ? ([{ command: 'close-path' }] as PathCommand[]) : []),
  ];
}

/**
 * Chamfers every vertex of a straight-line polygon with a uniform cut.
 * Each vertex is replaced by two points along its adjacent edges; the
 * cut on an edge is capped so neighbouring chamfers never overlap.
 * Open-path endpoints are left untouched.
 */
export function chamferPolygon(
  points: PolyPoint[],
  closed: boolean,
  cut: number,
): PathCommand[] {
  const n = points.length;
  const norm = Number.isFinite(cut) && cut > 0 ? cut : 0;

  const out: PolyPoint[] = [];
  const push = (p: PolyPoint): void => {
    const last = out[out.length - 1];
    if (last && samePoint(last, p)) return;
    out.push(p);
  };

  for (let i = 0; i < n; i++) {
    const curr = points[i];
    if (!curr) continue;
    if (norm === 0 || (!closed && (i === 0 || i === n - 1))) {
      push(curr);
      continue;
    }
    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;
    const prev = points[prevIdx];
    const next = points[nextIdx];
    if (!prev || !next) {
      push(curr);
      continue;
    }
    const distPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const distNext = Math.hypot(next.x - curr.x, next.y - curr.y);
    // an edge shared with an untouched open-path endpoint belongs to
    // this vertex alone, so it may use the full leg length
    const sharePrev = closed || prevIdx !== 0 ? 0.5 : 1;
    const shareNext = closed || nextIdx !== n - 1 ? 0.5 : 1;
    const offPrev = distPrev > POINT_EPS ? Math.min(norm, distPrev * sharePrev) : 0;
    const offNext = distNext > POINT_EPS ? Math.min(norm, distNext * shareNext) : 0;
    if (offPrev <= 0 && offNext <= 0) {
      push(curr);
      continue;
    }
    if (offPrev > 0 && distPrev > POINT_EPS) {
      push({
        x: curr.x + ((prev.x - curr.x) / distPrev) * offPrev,
        y: curr.y + ((prev.y - curr.y) / distPrev) * offPrev,
      });
    }
    if (offNext > 0 && distNext > POINT_EPS) {
      push({
        x: curr.x + ((next.x - curr.x) / distNext) * offNext,
        y: curr.y + ((next.y - curr.y) / distNext) * offNext,
      });
    }
  }

  if (closed) {
    const head = out[0];
    const tail = out[out.length - 1];
    if (head && tail && out.length > 1 && samePoint(head, tail)) {
      out.pop();
    }
  }
  return polygonCommands(out, closed);
}

/**
 * Maps stored original polygon points into a new bounding box
 * (translate + scale), so resizes/moves re-chamfer from the original
 * geometry instead of double-chamfering the current commands.
 */
export function mapPointsToBounds(
  pts: Array<[number, number]>,
  orig: ChamferBounds,
  next: ChamferBounds,
): PolyPoint[] {
  const sx = orig.width > EPS ? next.width / orig.width : 1;
  const sy = orig.height > EPS ? next.height / orig.height : 1;
  return pts.map(([x, y]) => ({
    x: next.x + (x - orig.x) * sx,
    y: next.y + (y - orig.y) * sy,
  }));
}
