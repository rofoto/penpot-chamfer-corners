import type { Cuts, PluginToUi, SelectionInfo, UiToPlugin } from '../model';

function post(message: UiToPlugin): void {
  parent.postMessage(message, '*');
}

const selectionList = document.querySelector<HTMLUListElement>('#selection-list');
const smokeList = document.querySelector<HTMLUListElement>('#smoke-list');
const smokeButton = document.querySelector<HTMLButtonElement>('#smoke-button');
const applyButton = document.querySelector<HTMLButtonElement>('#apply-button');
const removeButton = document.querySelector<HTMLButtonElement>('#remove-button');
const noticeEl = document.querySelector<HTMLDivElement>('#notice');

const cutInputs: Record<keyof Cuts, HTMLInputElement | null> = {
  tl: document.querySelector<HTMLInputElement>('#cut-tl'),
  tr: document.querySelector<HTMLInputElement>('#cut-tr'),
  br: document.querySelector<HTMLInputElement>('#cut-br'),
  bl: document.querySelector<HTMLInputElement>('#cut-bl'),
};

function currentCuts(): Cuts {
  const read = (el: HTMLInputElement | null): number => {
    const value = Number(el?.value ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  return {
    tl: read(cutInputs.tl),
    tr: read(cutInputs.tr),
    br: read(cutInputs.br),
    bl: read(cutInputs.bl),
  };
}

function setInputs(cuts: Cuts): void {
  for (const key of ['tl', 'tr', 'br', 'bl'] as const) {
    const el = cutInputs[key];
    if (el) el.value = String(cuts[key]);
  }
}

function describeChamfer(shape: SelectionInfo): string {
  const data = shape.chamfer;
  if (!data) return '';
  if (data.kind === 'frame-bg') return ' · chamfer background';
  const cuts = data.cuts;
  return ` · chamfer ${data.kind} tl=${cuts.tl} tr=${cuts.tr} br=${cuts.br} bl=${cuts.bl}`;
}

function renderSelection(selection: SelectionInfo[]): void {
  if (!selectionList) return;
  selectionList.innerHTML = '';
  if (selection.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'No selection';
    selectionList.append(li);
  } else {
    for (const shape of selection) {
      const li = document.createElement('li');
      const component = shape.isComponent ? ' [component]' : '';
      li.textContent = `${shape.name} (${shape.type}, r=${shape.rotation}°${component})${describeChamfer(shape)}`;
      selectionList.append(li);
    }
  }

  if (applyButton) applyButton.disabled = selection.length === 0;

  const removable = selection.some(
    (s) => s.chamfer && s.chamfer.kind !== 'frame-bg',
  );
  if (removeButton) removeButton.hidden = !removable;

  if (selection.length === 1) {
    const data = selection[0]?.chamfer;
    if (data && data.kind !== 'frame-bg') {
      setInputs(data.cuts);
    }
  }
}

function renderSmoke(
  results: Extract<PluginToUi, { type: 'smoke-results' }>['results'],
): void {
  if (!smokeList) return;
  smokeList.innerHTML = '';
  for (const result of results) {
    const li = document.createElement('li');
    li.className = result.ok ? 'ok' : 'fail';
    li.textContent = `${result.ok ? '✓' : '✗'} ${result.name} — ${result.detail}`;
    smokeList.append(li);
  }
  const failed = results.filter((r) => !r.ok).length;
  showNotice(
    failed === 0
      ? { level: 'info', text: `All ${results.length} probes passed.` }
      : { level: 'warn', text: `${failed} of ${results.length} probes failed.` },
  );
}

function showNotice(message: { level: string; text: string }): void {
  if (!noticeEl) return;
  noticeEl.hidden = false;
  noticeEl.className = `notice ${message.level}`;
  noticeEl.textContent = message.text;
}

window.addEventListener('message', (event: MessageEvent<PluginToUi>) => {
  const message = event.data;
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  switch (message.type) {
    case 'init':
      document.documentElement.dataset.theme = message.theme;
      renderSelection(message.selection);
      break;
    case 'selection':
      renderSelection(message.selection);
      break;
    case 'smoke-results':
      renderSmoke(message.results);
      break;
    case 'notice':
      showNotice(message);
      break;
  }
});

applyButton?.addEventListener('click', () => {
  post({ type: 'apply', cuts: currentCuts() });
});

removeButton?.addEventListener('click', () => {
  post({ type: 'remove' });
});

smokeButton?.addEventListener('click', () => {
  if (smokeList) smokeList.innerHTML = '';
  post({ type: 'run-smoke' });
});

post({ type: 'ready' });
