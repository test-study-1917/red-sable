import { writable } from 'svelte/store';

export const page = writable({
  url: new URL(location.href),
  params: {},
  route: { id: null },
  state: {},
});
export const navigating = writable(null);
export const updated = { ...writable(false), check: () => Promise.resolve(false) };
