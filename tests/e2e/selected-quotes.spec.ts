import en from '../../src/locales/en.json' with { type: 'json' };
import { expect, test, SIGNED_OUT } from './fixtures/test';
import { historyItems, timelineItem } from './fixtures/timeline-items';
import type { Locator } from '@playwright/test';

// Use real DOM ranges so the selection menu, formatted text and offsets are exercised together.
async function selectPassage(body: Locator, text: string, occurrence = 0): Promise<void> {
  await body.evaluate(
    (root, { text, occurrence }) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const full = nodes.map((node) => node.data).join('');
      let start = -1;
      for (let count = 0; count <= occurrence; count++) start = full.indexOf(text, start + 1);
      if (start < 0) throw new Error('passage missing');
      const range = document.createRange();
      let offset = 0;
      for (const node of nodes) {
        if (offset <= start && offset + node.length > start) range.setStart(node, start - offset);
        if (offset < start + text.length && offset + node.length >= start + text.length) {
          range.setEnd(node, start + text.length - offset);
          break;
        }
        offset += node.length;
      }
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    },
    { text, occurrence }
  );
}

test.use({ storageState: SIGNED_OUT });

for (const richTextComposer of [true, false]) {
  test(`selection menu inserts a Markdown quote without creating a reply (${richTextComposer ? 'rich' : 'source'})`, async ({
    page,
    app,
    core,
    installRoomCore,
  }) => {
    await page.addInitScript(
      (richTextComposer) =>
        localStorage.setItem('sable-preferences', JSON.stringify({ richTextComposer })),
      richTextComposer
    );
    await installRoomCore('ready');
    await app.openRoom('!room:example.test');
    await core.emitTimelineDiff(await core.subscription(), [
      { op: 'reset', values: [timelineItem('source', 'Before selected passage after')] },
    ]);
    await selectPassage(
      page.locator('[data-item-id="source"] .formatted-body'),
      'selected passage'
    );
    await expect(
      page.getByRole('menuitem', { name: en.timeline.quoteMarkdown, exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: en.timeline.quoteReply, exact: true })
    ).toBeVisible();
    await page.getByRole('menuitem', { name: en.timeline.quoteMarkdown, exact: true }).click();
    await expect(app.composer).toContainText('selected passage');
    if (richTextComposer)
      await expect(app.composer.locator('blockquote')).toHaveText('selected passage');
    else await expect(app.composer).toContainText('> selected passage');
    await app.sendMessage.click();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__e2eCalls.findLast((call) => call.method === 'messages.send')?.params
        )
      )
      .toMatchObject({ in_reply_to: null });
  });
}

test('touch: partial reply survives sending, expands, collapses and highlights the exact repeated passage', async ({
  page,
  app,
  core,
  installRoomCore,
}) => {
  await installRoomCore('ready');
  await app.openRoom('!room:example.test');
  const source = timelineItem('source', 'First passage; second passage. 中文 😀');
  await core.emitTimelineDiff(await core.subscription(), [{ op: 'reset', values: [source] }]);
  await selectPassage(page.locator('[data-item-id="source"] .formatted-body'), 'passage', 1);
  await page.getByRole('menuitem', { name: en.timeline.quoteReply, exact: true }).click();
  await app.composer.fill('My reply');
  await app.sendMessage.click();
  const selected_quote = {
    body: 'First passage; second passage. 中文 😀',
    text: 'passage',
    start: 22,
    end: 29,
  };
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__e2eCalls.findLast((call) => call.method === 'messages.send')?.params
      )
    )
    .toMatchObject({ in_reply_to: source.event_id, selected_quote });
  const reply = {
    ...timelineItem('reply', 'My reply'),
    in_reply_to: {
      event_id: source.event_id as string,
      sender: source.sender,
      sender_name: 'Alice',
      sender_mentioned: false,
      body: source.content.kind === 'message' ? source.content.body : '',
      fallback: null,
      selected_quote,
    },
  };
  await core.emitTimelineDiff(await core.subscription(), [
    { op: 'reset', values: [source, reply] },
  ]);
  const preview = page.locator('[data-item-id="reply"] .selected-reply');
  await expect(preview.locator('.quoted-source')).toHaveCount(0);
  await preview
    .getByRole('button', { name: en.timeline.expandQuote, exact: true })
    .click({ timeout: 5000 });
  await expect(preview.locator('.quoted-source')).toHaveText(selected_quote.body);
  await expect(preview.locator('mark')).toHaveText('passage');
  await preview.getByRole('button', { name: en.timeline.collapseQuote, exact: true }).click();
  await expect(preview.locator('.quoted-source')).toHaveCount(0);
  await preview.locator('.quote-summary').click();
  await expect(page.locator('[data-item-id="source"] mark.quoted-passage-highlight')).toHaveText(
    'passage'
  );
  await expect
    .poll(() =>
      page.locator('[data-item-id="source"] .formatted-body').evaluate((body) => {
        const mark = body.querySelector('mark.quoted-passage-highlight');
        if (!mark) return null;
        const prefix = document.createRange();
        prefix.selectNodeContents(body);
        prefix.setEndBefore(mark);
        return prefix.toString().length;
      })
    )
    .toBe(22);
  await page.screenshot({
    path: `test-results/selected-quote-collapsed-${page.viewportSize()?.width}.png`,
  });
  await preview
    .getByRole('button', { name: en.timeline.expandQuote, exact: true })
    .click({ timeout: 5000 });
  await page.screenshot({
    path: `test-results/selected-quote-expanded-${page.viewportSize()?.width}.png`,
  });
});

test('quote jump highlights a source row after virtualisation mounts it', async ({
  page,
  app,
  timeline,
  core,
  installRoomCore,
}) => {
  await installRoomCore('ready');
  await app.openRoom('!room:example.test');
  const source = timelineItem('source', 'The distant original passage.');
  const quote = { body: 'The distant original passage.', text: 'original', start: 12, end: 20 };
  const reply = {
    ...timelineItem('reply', 'Reply at the end'),
    in_reply_to: {
      event_id: source.event_id as string,
      sender: source.sender,
      sender_name: 'Alice',
      sender_mentioned: false,
      body: quote.body,
      fallback: null,
      selected_quote: quote,
    },
  };
  await core.emitTimelineDiff(await core.subscription(), [
    {
      op: 'reset',
      values: [
        source,
        ...historyItems({
          idPrefix: 'middle',
          label: 'History',
          count: 200,
          timestampBase: source.timestamp + 1,
        }),
        reply,
      ],
    },
  ]);
  await expect(timeline.itemById('reply')).toBeInViewport();
  await expect(timeline.itemById('source')).toHaveCount(0);
  await page.locator('[data-item-id="reply"] .quote-summary').click();
  await expect(timeline.itemById('source')).toBeInViewport();
  await expect(timeline.itemById('source').locator('mark.quoted-passage-highlight')).toHaveText(
    'original'
  );
});

test('touch: quote highlights fade in the last five seconds and refresh on every jump', async ({
  page,
  app,
  core,
  installRoomCore,
}) => {
  await installRoomCore('ready');
  await app.openRoom('!room:example.test');
  const body = 'Read the first passage, then the second passage.';
  const source = timelineItem('timed-source', body);
  const replies = ['first passage', 'second passage'].map((text, index) => ({
    ...timelineItem(`timed-reply-${String(index)}`, `A reply about the ${text}.`),
    in_reply_to: {
      event_id: source.event_id as string,
      sender: source.sender,
      sender_name: 'Alice',
      sender_mentioned: false,
      body,
      fallback: null,
      selected_quote: {
        body,
        text,
        start: body.indexOf(text),
        end: body.indexOf(text) + text.length,
      },
    },
  }));
  await core.emitTimelineDiff(await core.subscription(), [
    { op: 'reset', values: [source, ...replies] },
  ]);
  const first = page.locator('[data-item-id="timed-reply-0"] .quote-summary');
  const second = page.locator('[data-item-id="timed-reply-1"] .quote-summary');
  const mark = page.locator('[data-item-id="timed-source"] mark.quoted-passage-highlight');
  await expect(first).toBeVisible();
  await page.clock.install();
  await first.click();
  await expect(mark).toHaveText('first passage');
  const timing = await mark.evaluate((node) => {
    const animation = node.getAnimations()[0];
    return animation.effect?.getTiming();
  });
  expect(timing).toMatchObject({
    duration: 5_000,
    delay: 55_000,
    easing: 'linear',
    fill: 'forwards',
  });

  // Seek the actual browser animation to inspect its interpolation independently of fake JS time.
  const seekFade = async (time: number): Promise<string> =>
    mark.evaluate((node, time) => {
      const animation = node.getAnimations()[0];
      animation.pause();
      animation.currentTime = time;
      return getComputedStyle(node).backgroundColor;
    }, time);
  const fullColor = await seekFade(55_000);
  await page.screenshot({
    path: `test-results/quote-highlight-full-${page.viewportSize()?.width}.png`,
  });
  const fadingColor = await seekFade(57_500);
  expect(fadingColor).not.toBe(fullColor);
  // Halfway through the fade the highlight is half-transparent, not the message text.
  expect(fadingColor).toMatch(/(?:,|\/)\s*0\.5\s*\)$/);
  await page.screenshot({
    path: `test-results/quote-highlight-fading-${page.viewportSize()?.width}.png`,
  });
  const transparentColor = await seekFade(60_000);
  expect(transparentColor).toMatch(/(?:,|\/)\s*0\s*\)$/);

  await page.clock.fastForward(58_000);
  await second.click();
  await expect(mark).toHaveText('second passage');
  await expect(mark).toHaveCount(1);
  expect(await mark.evaluate((node) => Number(node.getAnimations()[0].currentTime))).toBeLessThan(
    1_000
  );
  await page.clock.fastForward(2_000);
  await expect(mark).toHaveText('second passage');
  await page.clock.fastForward(56_000);
  await second.click();
  await page.locator('[data-item-id="timed-reply-1"] .quote-toggle').click();
  await page.clock.fastForward(59_000);
  await expect(mark).toHaveText('second passage');
  await page.clock.fastForward(1_000);
  await expect(mark).toHaveCount(0);
  await expect(page.locator('[data-item-id="timed-source"] .formatted-body')).toHaveText(body);
  await expect(page.locator('[data-item-id="timed-reply-1"] .quoted-source mark')).toHaveText(
    'second passage'
  );
});

test('touch: message text is selectable and both quote actions fit the selection menu', async ({
  page,
  app,
  core,
  installRoomCore,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installRoomCore('ready');
  await app.openRoom('!room:example.test');
  await core.emitTimelineDiff(await core.subscription(), [
    { op: 'reset', values: [timelineItem('source', 'Before selected passage after')] },
  ]);
  const body = page.locator('[data-item-id="source"] .formatted-body');
  expect(await body.evaluate((node) => getComputedStyle(node).userSelect)).not.toBe('none');
  await selectPassage(body, 'selected passage');
  await expect(
    page.getByRole('menuitem', { name: en.timeline.quoteMarkdown, exact: true })
  ).toBeInViewport();
  await expect(
    page.getByRole('menuitem', { name: en.timeline.quoteReply, exact: true })
  ).toBeInViewport();
  await page.screenshot({ path: 'test-results/selected-quote-mobile-menu.png' });
});

for (const quoteIndex of [10, 112]) {
  test(`a long source message reveals its quoted passage in the preview and timeline (${quoteIndex})`, async ({
    page,
    app,
    core,
    installRoomCore,
  }) => {
    await installRoomCore('ready');
    await app.openRoom('!room:example.test');
    const paragraphs = Array.from({ length: 120 }, (_, index) =>
      index === quoteIndex
        ? 'The selected passage near the beginning.'
        : `Paragraph ${index}: surrounding context.`
    );
    const body = paragraphs.join('\n');
    const source = timelineItem('source', body);
    if (source.content.kind !== 'message') throw new Error('expected a text message');
    source.content.html = paragraphs.map((text) => `<p>${text}</p>`).join('');
    const start = body.indexOf('selected passage');
    const quote = { body, text: 'selected passage', start, end: start + 'selected passage'.length };
    const reply = {
      ...timelineItem('reply', 'Reply to a long message'),
      in_reply_to: {
        event_id: source.event_id as string,
        sender: source.sender,
        sender_name: 'Alice',
        sender_mentioned: false,
        body,
        fallback: null,
        selected_quote: quote,
      },
    };
    await core.emitTimelineDiff(await core.subscription(), [
      { op: 'reset', values: [source, reply] },
    ]);
    const preview = page.locator('[data-item-id="reply"] .selected-reply');
    await preview
      .getByRole('button', { name: en.timeline.expandQuote, exact: true })
      .click({ timeout: 5000 });
    await expect(preview.locator('.quoted-source mark')).toBeInViewport();
    await preview.getByRole('button', { name: en.timeline.collapseQuote, exact: true }).click();
    await preview.locator('.quote-summary').click();
    await expect(
      page.locator('[data-item-id="source"] mark.quoted-passage-highlight')
    ).toBeInViewport();
  });
}

for (const replyPreviewStyle of ['connected', 'compact', 'expanded'] as const) {
  for (const layout of ['modern', 'compact', 'bubble'] as const) {
    test(`touch: selected quotes follow ${replyPreviewStyle} styling in ${layout} messages`, async ({
      page,
      app,
      core,
      installRoomCore,
      isMobile,
    }) => {
      await page.setViewportSize({ width: isMobile ? 390 : 1280, height: 900 });
      await page.addInitScript(
        (settings) => localStorage.setItem('sable-preferences', JSON.stringify(settings)),
        {
          replyPreviewStyle,
          layout,
          alignOwnMessages: true,
        }
      );
      await installRoomCore('ready');
      await app.openRoom('!room:example.test');
      const body = [
        'Replies should feel at home in the conversation.',
        'Keep enough context to understand the message.',
        'We only need to adjust this one passage.',
        'The original wording and jump link stay intact.',
      ].join('\n');
      const text = 'adjust this one passage';
      const start = body.indexOf(text);
      const quote = { body, text, start, end: start + text.length };
      const source = timelineItem('style-source', body);
      const reply = {
        ...timelineItem('style-reply', 'Agreed. This feels more natural and is easier to read.'),
        sender: '@bob:example.test',
        sender_name: 'Bob',
        in_reply_to: {
          event_id: source.event_id as string,
          sender: source.sender,
          sender_name: 'Alice',
          sender_mentioned: false,
          body,
          fallback: null,
          selected_quote: quote,
        },
      };
      const own = {
        ...reply,
        ...timelineItem('style-own', 'Here is my reply about that particular passage.'),
        in_reply_to: reply.in_reply_to,
        sender: '@e2e:example.test',
        sender_name: 'You',
        is_own: true,
      };
      await core.emitTimelineDiff(await core.subscription(), [
        { op: 'reset', values: [source, reply, own] },
      ]);
      const previews = page.locator('.selected-reply');
      await expect(previews).toHaveCount(2);
      for (const preview of await previews.all()) {
        await expect(preview).toHaveClass(new RegExp(`reply-${replyPreviewStyle}`));
        const toggle = preview.getByRole('button', { name: en.timeline.expandQuote, exact: true });
        await expect(toggle).toBeVisible();
        expect(await toggle.innerText()).toBe('');
      }
      const screenshot = `test-results/quote-style-${replyPreviewStyle}-${layout}-${isMobile ? 'mobile' : 'desktop'}`;
      await page.screenshot({ path: `${screenshot}-collapsed.png` });
      for (const preview of await previews.all()) {
        const anchorBefore = await preview.evaluate(
          (node) => getComputedStyle(node, '::before').top
        );
        await preview
          .getByRole('button', { name: en.timeline.expandQuote, exact: true })
          .click({ timeout: 5000 });
        await expect(preview.locator('.quoted-source mark')).toHaveText(text);
        expect(await preview.locator('.quoted-source').textContent()).toBe(body);
        const metrics = await preview.locator('.quoted-source').evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            leading: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
            fits: node.scrollWidth <= node.clientWidth + 1,
          };
        });
        expect(metrics.leading).toBeLessThanOrEqual(1.4);
        expect(metrics.fits).toBe(true);
        if (replyPreviewStyle === 'connected') {
          expect(await preview.evaluate((node) => getComputedStyle(node, '::before').top)).toBe(
            anchorBefore
          );
        }
        const box = await preview.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.x).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(isMobile ? 390 : 1280);
      }
      if (replyPreviewStyle === 'expanded' && layout === 'bubble') {
        const alignment = await previews.nth(1).evaluate((node) => {
          const name = node.querySelector('.reply-name');
          const copy = node.querySelector('.reply-copy');
          if (!name || !copy) throw new Error('Missing quoted sender');
          return Math.abs(name.getBoundingClientRect().right - copy.getBoundingClientRect().right);
        });
        expect(alignment).toBeLessThanOrEqual(1);
      }
      if (replyPreviewStyle === 'connected' && layout !== 'compact') {
        await expect
          .poll(() =>
            page.locator('[data-item-id="style-reply"] .message').evaluate((node) => {
              const avatar = node.querySelector(
                ':scope > .avatar-button, :scope > .message-avatar'
              );
              const header = node.querySelector('.message-content > header');
              return avatar && header
                ? Math.abs(avatar.getBoundingClientRect().top - header.getBoundingClientRect().top)
                : 1000;
            })
          )
          .toBeLessThanOrEqual(6);
      }
      await page.screenshot({ path: `${screenshot}-expanded.png` });
    });
  }
}
