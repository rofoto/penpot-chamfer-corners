import type { Board, Path, Rectangle, Shape } from '@penpot/plugin-types';
import type {
  Cuts,
  ProbeResult,
  PluginToUi,
  SelectionInfo,
  UiToPlugin,
} from './model';
import { chamferCommands } from './geometry';
import {
  applyToShape,
  PLUGIN_KEY,
  readChamfer,
  regenerateIfOwner,
  removeFromShape,
} from './apply';

penpot.ui.open('Chamfer Corners', '', { width: 340, height: 560 });

function send(message: PluginToUi): void {
  penpot.ui.sendMessage(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`missing ${what}`);
  }
  return value;
}

function toInfo(shape: Shape): SelectionInfo {
  const bounds = shape.bounds;
  return {
    id: shape.id,
    name: shape.name,
    type: shape.type,
    rotation: shape.rotation,
    chamfer: readChamfer(shape),
    isComponent: shape.isComponentInstance(),
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
}

function selectionInfo(): SelectionInfo[] {
  return penpot.selection.map(toInfo);
}

penpot.ui.onMessage((raw: unknown) => {
  const message = raw as UiToPlugin;
  switch (message.type) {
    case 'ready':
      send({ type: 'init', theme: penpot.theme, selection: selectionInfo() });
      break;
    case 'run-smoke':
      void runSmoke();
      break;
    case 'apply':
      handleApply(message.cuts);
      break;
    case 'remove':
      handleRemove();
      break;
  }
});

function sendNotice(
  level: 'info' | 'warn' | 'error',
  lines: string[],
): void {
  send({ type: 'notice', level, text: lines.join('\n') });
}

function handleApply(cuts: Cuts): void {
  const selection = penpot.selection;
  if (selection.length === 0) {
    sendNotice('info', ['Nothing selected']);
    return;
  }
  const block = penpot.history.undoBlockBegin();
  const messages: string[] = [];
  const updated: Shape[] = [];
  let anyOk = false;
  try {
    for (const shape of selection) {
      const outcome = applyToShape(shape, cuts);
      messages.push(...outcome.messages);
      if (outcome.ok) {
        anyOk = true;
        updated.push(outcome.shape);
      }
    }
  } finally {
    penpot.history.undoBlockFinish(block);
  }
  if (updated.length > 0) penpot.selection = updated;
  send({ type: 'selection', selection: selectionInfo() });
  sendNotice(anyOk ? 'info' : 'warn', messages);
}

function handleRemove(): void {
  const selection = penpot.selection;
  if (selection.length === 0) {
    sendNotice('info', ['Nothing selected']);
    return;
  }
  const block = penpot.history.undoBlockBegin();
  const messages: string[] = [];
  const updated: Shape[] = [];
  let anyOk = false;
  try {
    for (const shape of selection) {
      const outcome = removeFromShape(shape);
      messages.push(...outcome.messages);
      if (outcome.ok) {
        anyOk = true;
        if (outcome.shape) updated.push(outcome.shape);
      }
    }
  } finally {
    penpot.history.undoBlockFinish(block);
  }
  if (updated.length > 0) penpot.selection = updated;
  send({ type: 'selection', selection: selectionInfo() });
  sendNotice(anyOk ? 'info' : 'warn', messages);
}

penpot.on('selectionchange', () => {
  send({ type: 'selection', selection: selectionInfo() });
});

penpot.on('shapechange', (shape) => {
  if (regenerateIfOwner(shape)) {
    if (penpot.selection.some((s) => s.id === shape.id)) {
      send({ type: 'selection', selection: selectionInfo() });
    }
  }
});

/* ------------------------------------------------------------------ */
/* Phase 0 smoke test                                                  */
/* ------------------------------------------------------------------ */

let smokeRunning = false;

async function runSmoke(): Promise<void> {
  if (smokeRunning) return;
  smokeRunning = true;

  const results: ProbeResult[] = [];
  const created: {
    rect?: Rectangle;
    path?: Path;
    board?: Board;
    child?: Rectangle;
  } = {};

  const probe = async (name: string, fn: () => Promise<string> | string) => {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail });
    } catch (err) {
      results.push({
        name,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };

  try {
    await probe('workspace-open', () => {
      const page = penpot.currentPage;
      if (!page) throw new Error('no active page — open a file first');
      return `page: ${page.name}`;
    });

    await probe('create-rect', () => {
      const rect = penpot.createRectangle();
      rect.name = 'chamfer smoke: rect';
      rect.resize(120, 80);
      rect.x = 40;
      rect.y = 40;
      created.rect = rect;
      return `id=${rect.id}`;
    });

    await probe('plugin-data', () => {
      const rect = need(created.rect, 'rect');
      rect.setPluginData(PLUGIN_KEY, '{"v":1,"kind":"rect"}');
      const back = rect.getPluginData(PLUGIN_KEY);
      if (back !== '{"v":1,"kind":"rect"}') {
        throw new Error(`read back: ${back}`);
      }
      return 'write + read ok (namespaced)';
    });

    await probe('flatten', async () => {
      const rect = need(created.rect, 'rect');
      const flattened = need(penpot.flatten([rect])[0], 'flattened path');
      created.path = flattened;
      const t0 = Date.now();
      while (flattened.type !== 'path' && Date.now() - t0 < 2000) {
        await sleep(50);
      }
      if (flattened.type !== 'path') {
        throw new Error(`still type=${flattened.type} after 2s`);
      }
      const sync = Date.now() - t0 < 60;
      return `became path, ${sync ? 'synchronous' : `async after ${Date.now() - t0}ms`}`;
    });

    await probe('plugin-data-after-flatten', () => {
      const path = need(created.path, 'path');
      const back = path.getPluginData(PLUGIN_KEY);
      if (back !== '{"v":1,"kind":"rect"}') {
        throw new Error(`read back: ${back}`);
      }
      if (path.id !== created.rect?.id) {
        throw new Error('id changed across flatten');
      }
      return 'marker + id survived flatten';
    });

    await probe('parent-preserved', () => {
      const path = need(created.path, 'path');
      return `parentIndex=${path.parentIndex}, name=${path.name}`;
    });

    await probe('commands-read', () => {
      const path = need(created.path, 'path');
      const commands = path.commands;
      if (!Array.isArray(commands) || commands.length === 0) {
        throw new Error('commands not a non-empty array');
      }
      const first = commands[0];
      const last = commands[commands.length - 1];
      return `${commands.length} cmds; first=${JSON.stringify(first)}; last=${JSON.stringify(last)}`;
    });

    await probe('commands-write', async () => {
      const path = need(created.path, 'path');
      const b = path.bounds;
      path.commands = chamferCommands(
        b,
        { tl: 16, tr: 8, br: 16, bl: 8 },
      );
      await sleep(100);
      const b2 = path.bounds;
      const delta = Math.max(
        Math.abs(b.x - b2.x),
        Math.abs(b.y - b2.y),
        Math.abs(b.width - b2.width),
        Math.abs(b.height - b2.height),
      );
      if (delta > 0.5) throw new Error(`bounds moved by ${delta}`);
      const back = path.commands;
      if (back.length !== 9) {
        throw new Error(`expected 9 commands, got ${back.length}`);
      }
      return `9 commands, bounds stable (delta ${delta})`;
    });

    await probe('shapechange', async () => {
      const path = need(created.path, 'path');
      let fired = false;
      const listener = penpot.on(
        'shapechange',
        () => {
          fired = true;
        },
        { shapeId: path.id },
      );
      const b = path.bounds;
      path.commands = chamferCommands(b, { tl: 4, tr: 12, br: 4, bl: 12 });
      await sleep(600);
      penpot.off(listener);
      if (!fired) throw new Error('listener did not fire within 600ms');
      return 'fired after commands write';
    });

    await probe('history-block', () => {
      const block = penpot.history.undoBlockBegin();
      penpot.history.undoBlockFinish(block);
      return 'begin + finish ok';
    });

    await probe('board', () => {
      const board = penpot.createBoard();
      board.name = 'chamfer smoke: board';
      board.x = 40;
      board.y = 160;
      board.resize(360, 220);
      const child = penpot.createRectangle();
      child.name = 'chamfer smoke: child';
      board.appendChild(child);
      created.board = board;
      created.child = child;
      return `board=${board.id}, children=${board.children.length}`;
    });

    await probe('layout-child-absolute', () => {
      const board = need(created.board, 'board');
      const child = need(created.child, 'child');
      board.addFlexLayout();
      const layoutChild = child.layoutChild;
      if (!layoutChild) throw new Error('layoutChild undefined after addFlexLayout');
      layoutChild.absolute = true;
      if (!layoutChild.absolute) throw new Error('absolute did not stick');
      return `flex dir=${board.flex?.dir ?? '?'}, absolute=true`;
    });

    await probe('board-props', () => {
      const board = need(created.board, 'board');
      const child = need(created.child, 'child');
      board.clipContent = true;
      if (!board.clipContent) throw new Error('clipContent did not stick');
      child.blocked = true;
      if (!child.blocked) throw new Error('blocked did not stick');
      return 'clipContent + blocked writable';
    });

    await probe('component-api', () => {
      const child = need(created.child, 'child');
      const names = [
        'isComponentInstance',
        'isComponentCopyInstance',
        'isComponentMainInstance',
        'isComponentRoot',
        'isComponentHead',
      ] as const;
      const missing = names.filter(
        (n) => typeof (child as unknown as Record<string, unknown>)[n] !== 'function',
      );
      if (missing.length > 0) throw new Error(`missing: ${missing.join(', ')}`);
      return 'all present';
    });

    await probe('find-shapes', () => {
      const page = need(penpot.currentPage, 'page');
      const paths = page.findShapes({ type: 'path' });
      const countDesc = (shape: Shape): number => {
        let n = 1;
        if ('children' in shape && shape.children) {
          for (const kid of shape.children) n += countDesc(kid);
        }
        return n;
      };
      return `findShapes(path)=${paths.length}; page tree=${countDesc(page.root)} shapes`;
    });
  } finally {
    smokeRunning = false;
    send({ type: 'smoke-results', results });
  }
}
