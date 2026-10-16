import type { Board, Path, Rectangle, Shape } from '@penpot/plugin-types';
import type { ChamferData, Cuts, FrameBgData } from './model';
import {
  chamferCommands,
  clampCuts,
  commandsSignature,
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

export interface ApplyOutcome {
  /** shape to re-select afterwards (the path after flatten) */
  shape: Shape;
  ok: boolean;
  messages: string[];
}

export function applyToShape(shape: Shape, cuts: Cuts): ApplyOutcome {
  if (Math.abs(shape.rotation) > 0.01) {
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
  switch (shape.type) {
    case 'rectangle':
      return applyRect(shape as Rectangle, cuts);
    case 'path':
      return applyExistingPath(shape as Path, cuts);
    case 'board':
      return applyBoard(shape as Board, cuts);
    default:
      return {
        shape,
        ok: false,
        messages: [
          `“${shape.name}” (${shape.type}) — only rectangles, boards and chamfered paths are supported`,
        ],
      };
  }
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
  return {
    shape: flattened,
    ok: true,
    messages: [`chamfered “${flattened.name}”`],
  };
}

function applyExistingPath(path: Path, cuts: Cuts): ApplyOutcome {
  const data = readChamfer(path);
  if (!data) {
    return {
      shape: path,
      ok: false,
      messages: [`“${path.name}” is a plain path — select a rectangle or board instead`],
    };
  }
  if (data.kind !== 'rect') {
    return {
      shape: path,
      ok: false,
      messages: [`“${path.name}” is a chamfer background — select its board instead`],
    };
  }
  const manualEdit =
    data.sig !== undefined && data.sig !== commandsSignature(path.commands);
  const clamped = clampCuts(path.bounds.width, path.bounds.height, cuts);
  finishPathWrite(path, clamped);
  const messages = [`updated chamfer on “${path.name}”`];
  if (manualEdit) {
    messages.push(`manual path edits on “${path.name}” were overwritten`);
  }
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
  messages.push(`chamfered board “${board.name}”`);
  return { shape: board, ok: true, messages };
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
    case 'frame-bg':
      return {
        shape,
        ok: false,
        messages: [`select the board, not its chamfer background`],
      };
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
    shape.commands = expected;
    writeChamfer(shape, {
      v: 1,
      kind: 'rect',
      cuts: data.cuts,
      sig: commandsSignature(expected),
    });
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
    return true;
  }

  return false;
}
