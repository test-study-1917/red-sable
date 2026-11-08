import type { RoomWidget } from './widget-content.js';

/** Detect Jitsi widgets created through Element, integration managers or Sable. */
export function isJitsiWidget(widget: RoomWidget): boolean {
  return /jitsi|meet\.jit\.si/i.test(`${widget.name} ${widget.type} ${widget.url}`);
}
