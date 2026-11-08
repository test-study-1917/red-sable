export const base = '';
export const assets = '';
export const app_dir = '_app';
export const resolve = (path: string): string => path;
export const asset = (path: string): string => `/${path.replace(/^\//, '')}`;
