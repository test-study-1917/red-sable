import { readText, writeText } from '#lib/platform/local-json.js';
import { PanelWidth } from '#lib/ui/panel-width.svelte.js';

export type RoomCallLayout = 'stacked' | 'side-by-side';
const KEY = 'sable-call-chat-layout';
const CALL_MIN_REM = 26;
const CHAT_MIN_REM = 22;
const GUTTER_PX = 8;
const HYSTERESIS_PX = 16;
export class RoomCallLayoutState {
  preferred = $state<RoomCallLayout | null>(null);
  wide = $state(false);
  width = $state(0);
  height = $state(0);
  rem = $state(16);
  readonly stacked = new PanelWidth('sable-call-stage-ratio', 0.4, 0.2, 0.8);
  readonly beside = new PanelWidth('sable-call-stage-width-ratio', 0.6, 0.2, 0.8);
  constructor() {
    const stored = readText(KEY);
    if (stored === 'stacked' || stored === 'side-by-side') this.preferred = stored;
    this.stacked.restore();
    this.beside.restore();
  }
  measure(width: number, height: number, rem: number): void {
    this.width = width;
    this.height = height;
    this.rem = rem;
    // Two usable columns plus a dedicated handle gutter. Hysteresis avoids flapping.
    this.wide =
      width >= (CALL_MIN_REM + CHAT_MIN_REM) * rem + GUTTER_PX + (this.wide ? 0 : HYSTERESIS_PX);
  }
  get layout(): RoomCallLayout {
    return this.wide && this.preferred !== 'stacked' ? 'side-by-side' : 'stacked';
  }
  get horizontal(): boolean {
    return this.layout === 'side-by-side';
  }
  get size(): PanelWidth {
    return this.horizontal ? this.beside : this.stacked;
  }
  get extent(): number {
    return Math.max(1, (this.horizontal ? this.width : this.height) - GUTTER_PX);
  }
  get min(): number {
    return this.horizontal
      ? (CALL_MIN_REM * this.rem) / this.extent
      : Math.min(0.65, 240 / this.extent);
  }
  get max(): number {
    return this.horizontal
      ? 1 - (CHAT_MIN_REM * this.rem) / this.extent
      : Math.max(this.min, Math.min(0.8, 1 - 180 / this.extent));
  }
  get ratio(): number {
    return Math.max(this.min, Math.min(this.max, this.size.width));
  }
  resize(value: number): void {
    this.size.resize(Math.max(this.min, Math.min(this.max, value)));
  }
  toggle(): void {
    if (!this.horizontal && !this.wide) return;
    this.preferred = this.horizontal ? 'stacked' : 'side-by-side';
    writeText(KEY, this.preferred);
  }
}
