import en from '../../src/locales/en.json' with { type: 'json' };
import { expect, test, SIGNED_OUT } from './fixtures/test';
import { threadSummary, timelineItem } from './fixtures/timeline-items';

test.use({ storageState: SIGNED_OUT, viewport: { width: 1400, height: 900 } });

test('opening a side panel leaves the room header and its buttons in place', async ({
  app,
  page,
  installRoomCore,
}) => {
  await installRoomCore('ready');
  await app.openRoom('!room:example.test');
  const threads = page
    .getByRole('toolbar', { name: en.room.actionsLabel })
    .getByRole('button', { name: en.timeline.threadsOpen });
  await expect(threads).toBeVisible();
  const before = await threads.boundingBox();

  await threads.click();
  await expect(page.getByRole('complementary', { name: en.timeline.threadsTitle })).toBeVisible();
  const after = await threads.boundingBox();

  expect(after).toEqual(before);
});

test('a side panel fills the space beside the timeline', async ({ app, page, installRoomCore }) => {
  await installRoomCore('ready');
  await app.openRoom('!room:example.test');
  await page
    .getByRole('toolbar', { name: en.room.actionsLabel })
    .getByRole('button', { name: en.timeline.threadsOpen })
    .click();
  const panel = page.getByRole('complementary', { name: en.timeline.threadsTitle });
  await expect(panel).toBeVisible();

  const room = await page.getByRole('main', { name: en.timeline.label }).boundingBox();
  const aside = await panel.boundingBox();
  if (room === null || aside === null) throw new Error('the room and its panel must have bounds');
  expect(aside.x + aside.width).toBeCloseTo(room.x + room.width, 0);
});

test('a thread side panel keeps its width beside the timeline', async ({
  app,
  page,
  core,
  installRoomCore,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('sable-preferences', JSON.stringify({ threadPresentation: 'panel' }));
  });
  await installRoomCore('ready');
  await app.openRoom('!room:example.test');
  const subscription = await core.subscription();
  await core.emitTimelineDiff(subscription, [
    {
      op: 'reset',
      values: [
        {
          ...timelineItem('thread-root', 'Root message'),
          thread_summary: threadSummary({
            num_replies: 3,
            latest_body: 'a reply',
            latest_sender: '@bob:example.test',
          }),
        },
      ],
    },
  ]);

  await page.locator('.thread-summary').first().click();
  const panel = page.getByRole('region', { name: en.timeline.thread, exact: true });
  await expect(panel).toBeVisible();

  const room = await page.getByRole('main', { name: en.timeline.label }).boundingBox();
  const thread = await panel.boundingBox();
  if (room === null || thread === null) throw new Error('the room and its thread must have bounds');
  const rem = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  );
  expect(thread.width).toBeCloseTo(27.5 * rem, 0);
  expect(thread.x + thread.width).toBeCloseTo(room.x + room.width, 0);
});

for (const [supported, alwaysShow, visible] of [
  [true, false, false],
  [true, true, true],
  [false, true, false],
] as const) {
  test(`large room call button: support=${supported}, always show=${alwaysShow}`, async ({
    page,
    app,
    installRoomCore,
  }) => {
    await page.addInitScript((alwaysShow) => {
      localStorage.setItem(
        'sable-preferences',
        JSON.stringify({ alwaysShowCallButton: alwaysShow })
      );
      window.__e2eMembers = Array.from({ length: 11 }, (_, index) => ({
        user_id: `@member${index}:example.test`,
        display_name: null,
        avatar_url: null,
        real_name: null,
        real_avatar_url: null,
        power_level: 0,
        membership: 'join',
        member_ts: null,
        kicked: false,
        service: false,
      }));
    }, alwaysShow);
    await installRoomCore(supported ? 'callable' : 'ready');
    await app.openRoom('!room:example.test');
    await expect
      .poll(() =>
        page.evaluate(() =>
          ['calls.support', 'members.list'].every((method) =>
            window.__e2eCalls.some((call) => call.method === method)
          )
        )
      )
      .toBe(true);
    await expect(page.getByRole('button', { name: en.call.start, exact: true })).toHaveCount(
      visible ? 1 : 0
    );
  });
}
