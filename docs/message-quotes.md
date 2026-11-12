# Quote a passage from a message

Select text inside a message to open its selection menu. The same actions are available when you right-click the selection.

- **Quote as Markdown** inserts a blockquote into the composer. In Markdown/source mode it inserts `>` lines. Write your response after the quote and send it as a normal message.
- **Reply to selection** creates a reply linked to the source message. After sending, use the chevron beside the quote to expand or collapse the source text, with the selected passage highlighted. Click the quoted sender or passage to jump to the original message and highlight the same passage.

The passage highlight in the original message lasts **one minute**, fading out during the final **five seconds**. Clicking another selected reply moves the highlight and restarts the minute; clicking the same quote again also restarts it. Scrolling away and back does not restart the timer. Highlights inside expanded reply previews remain visible while the preview is open.

Selected replies follow the **Connected line**, **Compact card**, or **Expanded card** style chosen in your timeline settings. Expanded source text uses compact line spacing and scrolls when it is long.

The normal **Reply** action still replies to the whole message. A selected reply is also retained in the room's reply draft. Sending an attachment, image gallery, sticker, GIF or location as the reply keeps the same selected passage.

## How selected text is retained

Replies use the standard Matrix `m.in_reply_to` relation, plus the `moe.sable.selected_quote` content field:

```json
{
  "body": "First passage; second passage.",
  "text": "passage",
  "start": 22,
  "end": 29
}
```

`body` is the source's rendered-text snapshot, not its Markdown source. `start` and `end` count UTF-16 code units, with `end` exclusive. Paragraph boundaries and line breaks are preserved; concealed spoilers are masked. Offsets identify the selected occurrence when text repeats.

The snapshot travels with the message, including local echoes. Other Matrix clients can display the standard reply; the inline selection controls require a client that understands the extension. Web builds need the updated WASM core, while server-backed clients need the updated server core.

If the source is edited, jumping tries to match the passage and its surrounding context. If the passage is gone or ambiguous, the client reports that it cannot locate it; the reply still displays the saved snapshot.
