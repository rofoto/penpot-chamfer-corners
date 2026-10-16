import type { Fill, Stroke } from '@penpot/plugin-types';

export type CornerKey = 'tl' | 'tr' | 'br' | 'bl';

export type Cuts = Record<CornerKey, number>;

export interface RectChamferData {
  v: 1;
  kind: 'rect';
  cuts: Cuts;
  /** signature of the last commands written by the plugin */
  sig?: string;
}

export interface FrameChamferData {
  v: 1;
  kind: 'frame';
  cuts: Cuts;
  /** id of the background path carrying the chamfer */
  bgId: string;
  /** fills captured before they were moved onto the background */
  origFills?: Fill[];
  /** strokes captured before they were moved onto the background */
  origStrokes?: Stroke[];
}

export interface FrameBgData {
  v: 1;
  kind: 'frame-bg';
  ownerId: string;
  cuts: Cuts;
  sig?: string;
}

export type ChamferData = RectChamferData | FrameChamferData | FrameBgData;

export interface SelectionInfo {
  id: string;
  name: string;
  type: string;
  rotation: number;
  chamfer: ChamferData | null;
  isComponent: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface ProbeResult {
  name: string;
  ok: boolean;
  detail: string;
}

/* UI -> plugin */

export interface ReadyMessage {
  type: 'ready';
}

export interface RunSmokeMessage {
  type: 'run-smoke';
}

export interface ApplyMessage {
  type: 'apply';
  cuts: Cuts;
}

export interface RemoveMessage {
  type: 'remove';
}

export type UiToPlugin =
  | ReadyMessage
  | RunSmokeMessage
  | ApplyMessage
  | RemoveMessage;

/* plugin -> UI */

export interface InitMessage {
  type: 'init';
  theme: 'light' | 'dark';
  selection: SelectionInfo[];
}

export interface SelectionMessage {
  type: 'selection';
  selection: SelectionInfo[];
}

export interface NoticeMessage {
  type: 'notice';
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface SmokeResultsMessage {
  type: 'smoke-results';
  results: ProbeResult[];
}

export type PluginToUi =
  | InitMessage
  | SelectionMessage
  | NoticeMessage
  | SmokeResultsMessage;
