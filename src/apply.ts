import type { Board, Path, Rectangle, Shape } from '@penpot/plugin-types';
import type {
  ChamferData,
  Cuts,
  FrameBgData,
  PathChamferData,
  RectChamferData,
} from './model';
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

export const PLUGIN_KEY = 'chamfer';

export function readChamfer(shape: Shape): ChamferData | null {
  const raw = shape.getPluginData(PLUGIN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ChamferData;
    if (parsed && parsed.v === 1) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function writeChamfer(shape: Shape, data: ChamferData): void {
  shape.setPluginData(PLUGIN_KEY, JSON.stringify(data));
}

export function boundsOf(shape: Shape): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const b = shape.bounds;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

function findById(root: Shape, id: string): Shape | null {
  if (root.id === id) return root;
  if ('children' in root && root.children) {
    for (const child of root.children) {
      const found = findById(child, id);
      if (found) return found;
    }
  }
  return null;
}

export function findShapeById(id: string): Shape | null {
  const page = penpot.currentPage;
  if (!page) return null;
  return findById(page.root, id);
}

/**
 * Counts chamfer background paths on the current page whose owner
 * board no longer exists.
 */
export function countOrphanedBackgrounds(): number {
  const page = penpot.currentPage;
  if (!page) return 0;
  let count = 0;
  const walk = (shape: Shape): void => {
    const data = readChamfer(shape);
    if (data?.kind === 'frame-bg' && !findShapeById(data.ownerId)) {
      count += 1;
    }
    if ('children' in shape && shape.children) {
      for (const child of shape.children) walk(child);
    }
  };
  walk(page.root);
  return count;
}

export interface ApplyOutcome {
  /** shape to re-select afterwards (the path after flatten) */
  shape: Shape;
  ok: boolean;
  messages: string[];
}

export function applyToShape(
  shape: Shape,
  cuts: Cuts,
  uniformCut = cuts.tl,
): ApplyOutcome {
  // arbitrary paths are chamfered in absolute page space, so rotation
  // does not affect the result
  if (shape.type !== 'path' && Math.abs(shape.rotation) > 0.01) {
    return {
      shape,
      ok: false,
      messages: [`“${shape.name}” is rotated — chamfer only works at 0°`],
    };
  }
  if (shape.isComponentInstance()) {
    return {
      shape,
      ok: false,
      messages: [
        `“${shape.name}” belongs to a component — skipped (it would break the component link)`,
      ],
    };
  }
  const bounds = shape.bounds;
  if (bounds.width < 0.01 || bounds.height < 0.01) {
    return {
      shape,
      ok: false,
      messages: [`“${shape.name}” has zero size — nothing to chamfer`],
    };
  }
  switch (shape.type) {
    case 'rectangle':
      return applyRect(shape as Rectangle, cuts);
    case 'path':
      return applyPath(shape as Path, cuts, uniformCut);
    case 'board':
      return applyBoard(shape as Board, cuts);
    default:
      return {
        shape,
        ok: false,
        messages: [
          `“${shape.name}” (${shape.type}) — only rectangles, boards and paths are supported`,
        ],
      };
  }
}

function applyPath(path: Path, cuts: Cuts, uniformCut: number): ApplyOutcome {
  const data = readChamfer(path);
  if (data?.kind === 'frame-bg') {
    return {
      shape: path,
      ok: false,
      messages: [`“${path.name}” is a chamfer background — select its board instead`],
    };
  }
  if (data?.kind === 'rect') {
    return applyExistingPath(path, cuts, data);
  }
  if (data?.kind === 'path') {
    return applyExistingArbitraryPath(path, data, uniformCut);
  }
  return applyArbitraryPath(path, uniformCut);
}

function applyArbitraryPath(path: Path, uniformCut: number): ApplyOutcome {
  const extracted = extractPolygon(path.commands);
  if (!extracted.ok) {
    return { shape: path, ok: false, messages: [`“${path.name}”: ${extracted.error}`] };
  }
  const cut = Number.isFinite(uniformCut) && uniformCut > 0 ? uniformCut : 0;
  if (cut === 0) {
    return {
      shape: path,
      ok: false,
      messages: [`“${path.name}”: the uniform cut is 0 — nothing to chamfer`],
    };
  }
  const origBounds = boundsOf(path);
  const commands = chamferPolygon(extracted.points, extracted.closed, cut);
  path.commands = commands;
  writeChamfer(path, {
    v: 1,
    kind: 'path',
    cut,
    pts: extracted.points.map((p) => [p.x, p.y] as [number, number]),
    closed: extracted.closed,
    origBounds,
    sig: commandsSignature(commands),
  });
  const shapeWord = extracted.closed ? 'closed' : 'open';
  return {
    shape: path,
    ok: true,
    messages: [
      `chamfered ${shapeWord} path “${path.name}” (${extracted.points.length} corners, cut ${cut}px)`,
    ],
  };
}

function applyExistingArbitraryPath(
  path: Path,
  data: PathChamferData,
  uniformCut: number,
): ApplyOutcome {
  const manualEdit =
    data.sig !== undefined && data.sig !== commandsSignature(path.commands);
  const cut = Number.isFinite(uniformCut) && uniformCut > 0 ? uniformCut : 0;
  const points = data.pts.map(([x, y]) => ({ x, y }));
  const commands = chamferPolygon(points, data.closed, cut);
  path.commands = commands;
  writeChamfer(path, { ...data, cut, sig: commandsSignature(commands) });
  const messages = [`updated chamfer on path “${path.name}” (cut ${cut}px)`];
  if (manualEdit) {
    messages.push(`manual path edits on “${path.name}” were overwritten`);
  }
  return { shape: path, ok: true, messages };
}

function clampNotice(requested: Cuts, clamped: Cuts): string | null {
  const keys = ['tl', 'tr', 'br', 'bl'] as const;
  const changed = keys.filter(
    (k) => Math.abs(requested[k] - clamped[k]) > 0.005,
  );
  if (changed.length === 0) return null;
  return `cuts clamped to fit: ${changed
    .map((k) => `${k} ${requested[k]}→${clamped[k]}`)
    .join(', ')}`;
}

function applyRect(rect: Rectangle, cuts: Cuts): ApplyOutcome {
  const clamped = clampCuts(rect.bounds.width, rect.bounds.height, cuts);
  const flattened = penpot.flatten([rect])[0];
  if (!flattened) {
    return {
      shape: rect,
      ok: false,
      messages: [`flatten failed for “${rect.name}”`],
    };
  }
  finishPathWrite(flattened, clamped);
  const messages = [`chamfered “${flattened.name}”`];
  const clampedMsg = clampNotice(cuts, clamped);
  if (clampedMsg) messages.push(clampedMsg);
  return { shape: flattened, ok: true, messages };
}

function applyExistingPath(
  path: Path,
  cuts: Cuts,
  data: RectChamferData,
): ApplyOutcome {
  const manualEdit =
    data.sig !== undefined && data.sig !== commandsSignature(path.commands);
  const clamped = clampCuts(path.bounds.width, path.bounds.height, cuts);
  finishPathWrite(path, clamped);
  const messages = [`updated chamfer on “${path.name}”`];
  if (manualEdit) {
    messages.push(`manual path edits on “${path.name}” were overwritten`);
  }
  const clampedMsg = clampNotice(cuts, clamped);
  if (clampedMsg) messages.push(clampedMsg);
  return { shape: path, ok: true, messages };
}

function finishPathWrite(path: Path, cuts: Cuts): void {
  const commands = chamferCommands(boundsOf(path), cuts);
  path.commands = commands;
  writeChamfer(path, {
    v: 1,
    kind: 'rect',
    cuts,
    sig: commandsSignature(commands),
  });
}

function applyBoard(board: Board, cuts: Cuts): ApplyOutcome {
  const bounds = boundsOf(board);
  const clamped = clampCuts(bounds.width, bounds.height, cuts);
  const data = readChamfer(board);
  const messages: string[] = [];

  let origFills = data?.kind === 'frame' ? data.origFills : undefined;
  let origStrokes = data?.kind === 'frame' ? data.origStrokes : undefined;

  let bg: Path | null = null;
  if (data?.kind === 'frame' && data.bgId) {
    const found = findShapeById(data.bgId);
    if (found && found.type === 'path') bg = found;
  }

  if (!bg) {
    const parent = board.parent;
    if (!parent || !('insertChild' in parent)) {
      return {
        shape: board,
        ok: false,
        messages: [`cannot place a background next to “${board.name}”`],
      };
    }
    origFills = Array.isArray(board.fills) ? [...board.fills] : [];
    origStrokes = [...board.strokes];
    const newBg = penpot.createPath();
    newBg.name = `${board.name} chamfer bg`;
    parent.insertChild(board.parentIndex, newBg);
    newBg.fills = origFills;
    newBg.strokes = origStrokes;
    board.fills = [];
    board.strokes = [];
    bg = newBg;
    messages.push(
      `created chamfer background for “${board.name}” (fills & strokes moved onto it)`,
    );
  }

  bg.x = bounds.x;
  bg.y = bounds.y;
  bg.resize(bounds.width, bounds.height);
  const commands = chamferCommands(boundsOf(bg), clamped);
  bg.commands = commands;
  const bgData: FrameBgData = {
    v: 1,
    kind: 'frame-bg',
    ownerId: board.id,
    cuts: clamped,
    sig: commandsSignature(commands),
  };
  writeChamfer(bg, bgData);
  writeChamfer(board, {
    v: 1,
    kind: 'frame',
    cuts: clamped,
    bgId: bg.id,
    origFills,
    origStrokes,
  });

  if (board.clipContent) {
    messages.push(
      `“${board.name}” clips content — children still clip to the square board, not the chamfer shape`,
    );
  }
  const clampedMsg = clampNotice(cuts, clamped);
  if (clampedMsg) messages.push(clampedMsg);
  messages.push(`chamfered board “${board.name}”`);
  return { shape: board, ok: true, messages };
}

/**
 * Creates an in-place copy of a shape for "duplicate" mode.
 * Rectangles and chamfered paths are copied with full visual fidelity;
 * other types are rejected with a hint to duplicate manually.
 */
export function duplicateForChamfer(
  shape: Shape,
): { shape: Shape } | { error: string } {
  if (shape.type === 'rectangle') {
    const rect = shape;
    const copy = penpot.createRectangle();
    copy.name = rect.name;
    const b = boundsOf(rect);
    copy.x = b.x;
    copy.y = b.y;
    copy.resize(b.width, b.height);
    if (Array.isArray(rect.fills)) copy.fills = [...rect.fills];
    copy.strokes = [...rect.strokes];
    copy.opacity = rect.opacity;
    const parent = rect.parent;
    if (parent && 'insertChild' in parent) {
      parent.insertChild(rect.parentIndex + 1, copy);
    }
    return { shape: copy };
  }
  if (shape.type === 'path') {
    const data = readChamfer(shape);
    if (!data || (data.kind !== 'rect' && data.kind !== 'path')) {
      return {
        error: `“${shape.name}” is a plain path — duplicate mode supports rectangles and chamfered paths`,
      };
    }
    const copy = penpot.createPath();
    copy.name = shape.name;
    const parent = shape.parent;
    if (parent && 'insertChild' in parent) {
      parent.insertChild(shape.parentIndex + 1, copy);
    }
    if (Array.isArray(shape.fills)) copy.fills = [...shape.fills];
    copy.strokes = [...shape.strokes];
    copy.opacity = shape.opacity;
    copy.commands = shape.commands;
    copy.setPluginData(PLUGIN_KEY, JSON.stringify(data));
    return { shape: copy };
  }
  return {
    error: `duplicate mode supports rectangles and chamfered paths only — for “${shape.name}” duplicate it manually (Ctrl+D) or turn off duplicate`,
  };
}

export interface RemoveOutcome {
  /** shape to re-select, or null when it was deleted */
  shape: Shape | null;
  ok: boolean;
  messages: string[];
}

export function removeFromShape(shape: Shape): RemoveOutcome {
  const data = readChamfer(shape);
  if (!data) {
    return {
      shape,
      ok: false,
      messages: [`“${shape.name}” has no chamfer to remove`],
    };
  }
  switch (data.kind) {
    case 'rect': {
      if (shape.type !== 'path') {
        return {
          shape,
          ok: false,
          messages: [`“${shape.name}” is not a chamfered path`],
        };
      }
      const path = shape;
      const bounds = boundsOf(path);
      const rect = penpot.createRectangle();
      rect.name = path.name;
      rect.x = bounds.x;
      rect.y = bounds.y;
      rect.resize(bounds.width, bounds.height);
      if (Array.isArray(path.fills)) rect.fills = [...path.fills];
      rect.strokes = [...path.strokes];
      const parent = path.parent;
      if (parent && 'insertChild' in parent) {
        parent.insertChild(path.parentIndex, rect);
      }
      if ('remove' in path) path.remove();
      return {
        shape: rect,
        ok: true,
        messages: [
          `recreated “${rect.name}” as a rectangle (new id — flatten had already re-keyed it)`,
        ],
      };
    }
    case 'path': {
      if (shape.type !== 'path') {
        return {
          shape,
          ok: false,
          messages: [`“${shape.name}” is not a chamfered path`],
        };
      }
      const path = shape;
      const original = penpot.createPath();
      original.name = path.name;
      const points = data.pts.map(([x, y]) => ({ x, y }));
      const parent = path.parent;
      if (parent && 'insertChild' in parent) {
        parent.insertChild(path.parentIndex, original);
      }
      if (Array.isArray(path.fills)) original.fills = [...path.fills];
      original.strokes = [...path.strokes];
      original.opacity = path.opacity;
      original.commands = polygonCommands(points, data.closed);
      if ('remove' in path) path.remove();
      return {
        shape: original,
        ok: true,
        messages: [
          `restored “${original.name}” to its original outline (new id)`,
        ],
      };
    }
    case 'frame': {
      if (shape.type !== 'board') {
        return {
          shape,
          ok: false,
          messages: [`“${shape.name}” is not a board`],
        };
      }
      const board = shape;
      const bg = data.bgId ? findShapeById(data.bgId) : null;
      if (bg && 'remove' in bg) bg.remove();
      board.fills = data.origFills ? [...data.origFills] : [];
      board.strokes = data.origStrokes ? [...data.origStrokes] : [];
      board.setPluginData(PLUGIN_KEY, '');
      return {
        shape: board,
        ok: true,
        messages: [`removed chamfer background from “${board.name}”`],
      };
    }
    case 'frame-bg': {
      if (shape.type !== 'path') {
        return {
          shape,
          ok: false,
          messages: [`“${shape.name}” is not a chamfer background path`],
        };
      }
      const owner = findShapeById(data.ownerId);
      if (owner) {
        return {
          shape,
          ok: false,
          messages: [
            `“${shape.name}” backs “${owner.name}” — select the board and use Remove there`,
          ],
        };
      }
      if ('remove' in shape) shape.remove();
      return {
        shape: null,
        ok: true,
        messages: [`deleted orphaned chamfer background “${shape.name}”`],
      };
    }
  }
}

/**
 * Keeps chamfered shapes in sync with resizes/moves:
 * - a chamfered rect-path regenerates its commands when its bounds change
 *   while the plugin still owns the path (sig matches)
 * - a chamfered board regenerates its background path
 * Manual pen-tool edits (sig mismatch) are left alone.
 */
export function regenerateIfOwner(shape: Shape): boolean {
  const data = readChamfer(shape);
  if (!data) return false;

  if (data.kind === 'rect' && shape.type === 'path') {
    if (!data.sig) return false;
    if (commandsSignature(shape.commands) !== data.sig) return false;
    const expected = chamferCommands(boundsOf(shape), data.cuts);
    if (sameCommands(shape.commands, expected)) return false;
    const block = penpot.history.undoBlockBegin();
    try {
      shape.commands = expected;
      writeChamfer(shape, {
        v: 1,
        kind: 'rect',
        cuts: data.cuts,
        sig: commandsSignature(expected),
      });
    } finally {
      penpot.history.undoBlockFinish(block);
    }
    return true;
  }

  if (data.kind === 'path' && shape.type === 'path') {
    if (!data.sig) return false;
    if (commandsSignature(shape.commands) !== data.sig) return false;
    const mapped = mapPointsToBounds(
      data.pts,
      data.origBounds,
      boundsOf(shape),
    );
    const expected = chamferPolygon(mapped, data.closed, data.cut);
    if (sameCommands(shape.commands, expected)) return false;
    const block = penpot.history.undoBlockBegin();
    try {
      shape.commands = expected;
      writeChamfer(shape, { ...data, sig: commandsSignature(expected) });
    } finally {
      penpot.history.undoBlockFinish(block);
    }
    return true;
  }

  if (data.kind === 'frame' && shape.type === 'board') {
    if (!data.bgId) return false;
    const found = findShapeById(data.bgId);
    if (!found || found.type !== 'path') return false;
    const bg = found;
    const bgData = readChamfer(bg);
    if (
      bgData?.kind === 'frame-bg' &&
      bgData.sig !== undefined &&
      commandsSignature(bg.commands) !== bgData.sig
    ) {
      return false;
    }
    const expected = chamferCommands(boundsOf(shape), data.cuts);
    if (sameCommands(bg.commands, expected)) return false;
    const bounds = boundsOf(shape);
    const block = penpot.history.undoBlockBegin();
    try {
      bg.x = bounds.x;
      bg.y = bounds.y;
      bg.resize(bounds.width, bounds.height);
      bg.commands = expected;
      writeChamfer(bg, {
        v: 1,
        kind: 'frame-bg',
        ownerId: shape.id,
        cuts: data.cuts,
        sig: commandsSignature(expected),
      });
    } finally {
      penpot.history.undoBlockFinish(block);
    }
    return true;
  }

  return false;
}
