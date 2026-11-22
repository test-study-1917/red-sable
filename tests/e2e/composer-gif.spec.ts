import { expect, test, SIGNED_OUT } from './fixtures/test';
import en from '../../src/locales/en.json' with { type: 'json' };

test.use({ storageState: SIGNED_OUT });

test.beforeEach(async ({ page }) => {
  await page.route('**/config.json', (route) =>
    route.fulfill({
      json: {
        gifs: { provider: 'tenor', tenorApiKey: 'test', proxyUrl: 'gifs.example.test' },
        embeds: { serviceUrl: 'https://gifs.example.test' },
      },
    })
  );
  await page.route('https://gifs.example.test/**', (route) =>
    route.fulfill({ json: { results: [] } })
  );
});

test('GIF and sticker buttons are hidden by default while slash gif still opens the picker', async ({
  page,
  app,
  installRoomCore,
}) => {
  await page.setViewportSize({ width: 849, height: 756 });
  await installRoomCore('ready');
  await app.openRoom('!room:example.test');
  const toolbar = page.locator('.composer-after');
  await expect(
    toolbar.getByRole('button', { name: en.composer.emotesAndStickers, exact: true })
  ).toBeVisible();
  await expect(toolbar.getByRole('button', { name: en.composer.openStickerPicker })).toHaveCount(0);
  await app.composer.fill('/gif cats');
  await app.composer.press('Enter');
  const board = page.locator('.composer-board');
  await expect(board).toBeVisible();
  await expect(board).toBeInViewport();
  await expect(board.getByRole('button', { name: en.composer.gifs, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(toolbar.getByRole('button', { name: en.composer.openGifPicker })).toHaveCount(0);
});

test.describe('mobile picker', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 508 } });

  for (const [label, tab] of [
    [en.composer.openGifPicker, en.composer.gifs],
    [en.composer.openStickerPicker, en.composer.stickers],
    [en.composer.emotesAndStickers, en.composer.emoticons],
  ]) {
    test(`${tab} picker opens while the Android keyboard closes`, async ({
      page,
      app,
      installRoomCore,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium');
      if (tab !== en.composer.emoticons) {
        await page.addInitScript(() => {
          localStorage.setItem(
            'sable-preferences',
            JSON.stringify({ composerGifButton: true, composerStickerButton: true })
          );
        });
      }
      await installRoomCore('ready');
      await app.openRoom('!room:example.test');
      await page.evaluate(() => {
        document.documentElement.dataset.tauriOs = 'android';
      });
      await app.composer.fill('draft');
      await expect(app.composer).toBeFocused();
      await page.exposeFunction('hideKeyboard', () =>
        page.setViewportSize({ width: 390, height: 844 })
      );
      await app.composer.evaluate((node) => {
        node.addEventListener('blur', () => {
          void (window as unknown as { hideKeyboard: () => Promise<void> }).hideKeyboard();
        });
      });

      const button = page.getByRole('button', { name: label, exact: true });
      await expect(button).toBeVisible();
      const bounds = await button.boundingBox();
      if (!bounds) throw new Error('missing picker button');
      const session = await page.context().newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }],
      });
      await expect.soft(app.composer).toBeFocused();
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.detach();

      const sheet = page.getByRole('dialog', { name: en.composer.emotesAndStickers });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('button', { name: tab, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(button).toHaveAttribute('data-state', 'open');
      if (tab === en.composer.emoticons) {
        await expect(page.getByRole('button', { name: en.composer.openGifPicker })).toHaveCount(0);
        await expect(page.getByRole('button', { name: en.composer.openStickerPicker })).toHaveCount(
          0
        );
      }
      await expect(app.composer).toHaveText('draft');
      await expect.poll(() => page.viewportSize()?.height).toBe(844);
    });
  }
});
