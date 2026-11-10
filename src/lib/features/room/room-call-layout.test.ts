import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomCallLayoutState } from './room-call-layout.svelte.js';

describe('room call layout', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('uses actual available width and hysteresis without overwriting the preference', () => {
    const state = new RoomCallLayoutState();
    state.measure(1000, 800, 16);
    expect(state.layout).toBe('side-by-side');
    state.toggle();
    state.measure(1500, 800, 16);
    expect(state.layout).toBe('stacked');
    state.toggle();
    state.measure(775, 800, 16);
    expect(state.layout).toBe('stacked');
    expect(state.preferred).toBe('side-by-side');
    state.measure(790, 800, 16);
    expect(state.layout).toBe('stacked');
    state.measure(800, 800, 16);
    expect(state.layout).toBe('side-by-side');
  });
  it('keeps axes independent and clamps both columns', () => {
    const state = new RoomCallLayoutState();
    state.measure(1000, 800, 16);
    state.resize(0.8);
    expect(state.ratio * state.extent).toBeCloseTo(640);
    state.toggle();
    expect(state.ratio).toBe(0.4);
    state.resize(0.8);
    expect((1 - state.ratio) * state.extent).toBeCloseTo(180);
    state.toggle();
    expect(state.ratio * state.extent).toBeCloseTo(640);
  });
  it('restores the old height only as height and keeps explicit preference across rooms', () => {
    localStorage.setItem('sable-call-stage-ratio', '0.72');
    const first = new RoomCallLayoutState();
    first.measure(1000, 800, 16);
    expect(first.ratio).toBe(0.6);
    first.toggle();
    expect(first.ratio).toBe(0.72);
    const second = new RoomCallLayoutState();
    second.measure(1400, 800, 16);
    expect(second.layout).toBe('stacked');
    expect(second.ratio).toBe(0.72);
  });
  it('reserves a usable chat and wrapped controls in short windows without storing clamps', () => {
    const state = new RoomCallLayoutState();
    state.measure(390, 444, 16);
    expect(state.ratio * state.extent).toBe(240);
    state.resize(0.8);
    expect((1 - state.ratio) * state.extent).toBeCloseTo(180);
    state.measure(1000, 800, 16);
    expect(state.beside.width).toBe(0.6);
  });
});
