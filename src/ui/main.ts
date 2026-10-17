import type {
  CornerKey,
  Cuts,
  PluginToUi,
  SelectionInfo,
  UiToPlugin,
} from '../model';

const STORAGE_KEY = 'chamfer-corners.v1';

function post(message: UiToPlugin): void {
  parent.postMessage(message, '*');
}

const selectionList = document.querySelector<HTMLUListElement>('#selection-list');
const smokeList = document.querySelector<HTMLUListElement>('#smoke-list');
const smokeButton = document.querySelector<HTMLButtonElement>('#smoke-button');
const applyButton = document.querySelector<HTMLButtonElement>('#apply-button');
const removeButton = document.querySelector<HTMLButtonElement>('#remove-button');
const noticeEl = document.querySelector<HTMLDivElement>('#notice');
const duplicateEl = document.querySelector<HTMLInputElement>('#duplicate');
const liveEl = document.querySelector<HTMLInputElement>('#live');

const CORNERS: CornerKey[] = ['tl', 'tr', 'bl', 'br'];

const cutInputs: Record<CornerKey, HTMLInputElement | null> = {
  tl: document.querySelector<HTMLInputElement>('#cut-tl'),
  tr: document.querySelector<HTMLInputElement>('#cut-tr'),
  br: document.querySelector<HTMLInputElement>('#cut-br'),
  bl: document.querySelector<HTMLInputElement>('#cut-bl'),
};

const enableInputs: Record<CornerKey, HTMLInputElement | null> = {
  tl: document.querySelector<HTMLInputElement>('#en-tl'),
  tr: document.querySelector<HTMLInputElement>('#en-tr'),
  br: document.querySelector<HTMLInputElement>('#en-br'),
  bl: document.querySelector<HTMLInputElement>('#en-bl'),
};

function isEnabled(key: CornerKey): boolean {
  return enableInputs[key]?.checked ?? true;
}

function currentCuts(): Cuts {
  const read = (key: CornerKey): number => {
    if (!isEnabled(key)) return 0;
    const value = Number(cutInputs[key]?.value ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  return { tl: read('tl'), tr: read('tr'), br: read('br'), bl: read('bl') };
}

function syncEnabled(): void {
  for (const key of CORNERS) {
    const input = cutInputs[key];
    if (input) input.disabled = !isEnabled(key);
  }
}

function setInputs(cuts: Cuts, enableNonZero = false): void {
  for (const key of CORNERS) {
    const input = cutInputs[key];
    if (input) input.value = String(cuts[key]);
    if (enableNonZero && cuts[key] > 0 && enableInputs[key]) {
      enableInputs[key].checked = true;
    }
  }
  syncEnabled();
}

/* ---------------- state persistence ---------------- */

interface UiState {
  cuts: Cuts;
  enabled: Record<CornerKey, boolean>;
  duplicate: boolean;
  live: boolean;
}

function readState(): UiState {
  return {
    cuts: currentCuts(),
    enabled: {
      tl: isEnabled('tl'),
      tr: isEnabled('tr'),
      br: isEnabled('br'),
      bl: isEnabled('bl'),
    },
    duplicate: duplicateEl?.checked ?? false,
    live: liveEl?.checked ?? false,
  };
}

function persistState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readState()));
  } catch {
    /* storage unavailable — fine */
  }
}

function restoreState(): void {
  let state: UiState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    state = JSON.parse(raw) as UiState;
  } catch {
    return;
  }
  if (state.cuts) setInputs(state.cuts);
  for (const key of CORNERS) {
    if (state.enabled && enableInputs[key]) {
      enableInputs[key].checked = state.enabled[key] ?? true;
    }
  }
  if (duplicateEl) duplicateEl.checked = state.duplicate ?? false;
  if (liveEl) {
    liveEl.checked = state.live ?? false;
    liveEl.disabled = duplicateEl?.checked ?? false;
  }
  syncEnabled();
}

/* ---------------- live preview ---------------- */

let liveTimer: number | undefined;

function scheduleLive(): void {
  if (!liveEl?.checked || duplicateEl?.checked) return;
  window.clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => {
    post({ type: 'apply', cuts: currentCuts() });
  }, 400);
}

/* ---------------- rendering ---------------- */

function describeChamfer(shape: SelectionInfo): string {
  const data = shape.chamfer;
  if (!data) return '';
  if (data.kind === 'frame-bg') {
    return shape.bgOrphaned
      ? ' · chamfer background (orphaned)'
      : ' · chamfer background';
  }
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
    (s) => s.chamfer && (s.chamfer.kind !== 'frame-bg' || s.bgOrphaned),
  );
  if (removeButton) removeButton.hidden = !removable;

  if (selection.length === 1) {
    const data = selection[0]?.chamfer;
    if (data && data.kind !== 'frame-bg') {
      setInputs(data.cuts, true);
      persistState();
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

/* ---------------- events ---------------- */

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
  post({
    type: 'apply',
    cuts: currentCuts(),
    duplicate: duplicateEl?.checked ?? false,
  });
});

removeButton?.addEventListener('click', () => {
  post({ type: 'remove' });
});

smokeButton?.addEventListener('click', () => {
  if (smokeList) smokeList.innerHTML = '';
  post({ type: 'run-smoke' });
});

for (const key of CORNERS) {
  const input = cutInputs[key];
  input?.addEventListener('input', () => {
    persistState();
    scheduleLive();
  });
  input?.addEventListener(
    'wheel',
    (event) => {
      if (document.activeElement !== input) return;
      event.preventDefault();
      const current = Number(input.value) || 0;
      const next = Math.max(0, current - Math.sign(event.deltaY));
      input.value = String(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { passive: false },
  );
  enableInputs[key]?.addEventListener('change', () => {
    syncEnabled();
    persistState();
    scheduleLive();
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
  button.addEventListener('click', () => {
    const value = Number(button.dataset.preset ?? 0);
    for (const key of CORNERS) {
      if (isEnabled(key) && cutInputs[key]) {
        cutInputs[key].value = String(value);
      }
    }
    persistState();
    scheduleLive();
  });
}

duplicateEl?.addEventListener('change', () => {
  if (liveEl) {
    liveEl.disabled = duplicateEl.checked;
    if (duplicateEl.checked) liveEl.checked = false;
  }
  persistState();
});

liveEl?.addEventListener('change', () => {
  persistState();
});

/* ---------------- init ---------------- */

restoreState();
post({ type: 'ready' });
