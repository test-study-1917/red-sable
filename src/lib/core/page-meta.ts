import { createContext, type Snippet } from 'svelte';

export class PageMeta {
  title: string = '';
  readonly mobileHeader: boolean = false;
  mobileActions: Snippet | undefined;
}

export const [usePageMeta, providePageMeta, hasPageMeta] = createContext<PageMeta>();
