import { page } from './call-kit-state';

export function goto(
  _url: string,
  options: { state?: Record<string, unknown>; shallow?: boolean; replace?: boolean } = {}
): Promise<void> {
  Object.assign(page.state, options.state);
  if (options.shallow) {
    history[options.replace ? 'replaceState' : 'pushState']({ ...page.state }, '', location.href);
  }
  return Promise.resolve();
}
export function beforeNavigate(): void {}
export function afterNavigate(): void {}
export function onNavigate(): void {}
