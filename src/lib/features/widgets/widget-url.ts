import { runTemplate, type IWidget } from 'matrix-widget-api';

import type { RoomWidget } from './widget-content.js';

export interface WidgetTemplateVars {
  userId: string;
  roomId: string;
  displayName: string;
  avatarUrl: string;
  deviceId?: string;
  baseUrl?: string;
  clientTheme?: string;
  clientLanguage?: string;
}

export const WIDGET_CLIENT_ID = 'moe.sable.next';

export function templateWidgetUrl(widget: RoomWidget, vars: WidgetTemplateVars): string {
  // Direct Jitsi conference test.
  if (widget.type === 'm.jitsi') {
    const conferenceId = widget.data.conferenceId;
    const domain = widget.data.domain;

    if (
      domain === 'meet.element.io' &&
      typeof conferenceId === 'string' &&
      /^[A-Za-z0-9_-]{8,128}$/.test(conferenceId)
    ) {
      const jitsi = new URL('https://meet.element.io/');
      jitsi.pathname = `/${encodeURIComponent(conferenceId)}`;

      return jitsi.toString();
    }
  }

  const definition: IWidget = {
    id: widget.id,
    creatorUserId: vars.userId,
    type: widget.type,
    url: widget.url,
    name: widget.name,
    data: widget.data,
  };

  const resolved = runTemplate(widget.url, definition, {
    widgetRoomId: vars.roomId,
    currentUserId: vars.userId,
    userDisplayName: vars.displayName,
    userHttpAvatarUrl: vars.avatarUrl,
    clientId: WIDGET_CLIENT_ID,
    clientTheme: vars.clientTheme,
    clientLanguage: vars.clientLanguage,
    deviceId: vars.deviceId,
    baseUrl: vars.baseUrl,
  });

  try {
    const parsed = new URL(resolved);

    if (
      widget.type === 'm.jitsi' &&
      parsed.origin === 'https://scalar.vector.im' &&
      parsed.pathname === '/api/widgets/jitsi.html'
    ) {
      const conferenceId = widget.data.conferenceId;
      const domain = widget.data.domain;

      if (typeof conferenceId === 'string' && conferenceId.length > 0) {
        parsed.searchParams.set('confId', conferenceId);
      }

      if (typeof domain === 'string' && domain.length > 0) {
        parsed.searchParams.set('domain', domain);
      }

      parsed.searchParams.set('isAudioConf', widget.data.isAudioOnly === true ? 'true' : 'false');
    }
    if (!parsed.searchParams.has('widgetId')) parsed.searchParams.set('widgetId', widget.id);
    return parsed.toString();
  } catch {
    return resolved;
  }
}
