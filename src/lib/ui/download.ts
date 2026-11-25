import { i18n } from '#lib/i18n.js';
import { saveBytes, saveUrl, savesNatively, type SaveOutcome } from '#lib/platform/files.js';
import { preferences } from '#lib/settings/preferences.svelte.js';
import { toasts } from '#lib/ui/toasts.svelte.js';

export async function downloadUrl(url: string, filename: string): Promise<void> {
  reportSave(await saveUrl(url, filename, preferences.askDownloadLocation));
}

export async function downloadBytes(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  mime: string | null
): Promise<void> {
  reportSave(
    await saveBytes(
      bytes,
      filename || 'attachment',
      mime ?? 'application/octet-stream',
      preferences.askDownloadLocation
    )
  );
}

export function reportSave(outcome: SaveOutcome): void {
  if (outcome === 'saved') confirmSaved();
  if (outcome === 'failed' && savesNatively()) toasts.error(i18n.t('errors.actionFailed'));
}

/** For callers that show their own error. Browser downloads already show in the browser. */
export function confirmSaved(): void {
  if (savesNatively()) toasts.info(i18n.t('viewer.saved'));
}
