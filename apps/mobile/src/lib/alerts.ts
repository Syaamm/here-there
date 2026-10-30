import type { Notif } from './api';

/** Where tapping an alert goes (null: nowhere, it is only information). The page itself flips to its own product (useEnterMode). */
export function alertRoute(n: Pick<Notif, 'type' | 'data'>): string | null {
  const d = n.data;
  if (n.type.startsWith('attendance_')) return '/reliability';
  if (n.type === 'warning' && d?.warningId) return `/appeal?kind=warning&targetId=${d.warningId}`;
  if (n.type === 'message_removed' && d?.messageId) return `/appeal?kind=message&targetId=${d.messageId}`;
  if (n.type === 'appeal_decided') return '/appeal';
  if (n.type === 'report_update') return '/my-reports';
  if (d?.conversationId) return `/chat/${d.conversationId}`;
  if (n.type === 'join_request' && d?.activityId) return `/host/${d.activityId}`;
  if (n.type === 'trip_application' && d?.tripId) return `/review/${d.tripId}`;
  if (d?.activityId) return `/activity/${d.activityId}`;
  if (d?.tripId) return `/trip/${d.tripId}`;
  if (n.type === 'follow' && (d as { userId?: string } | null)?.userId) return `/user/${(d as { userId: string }).userId}`;
  if (n.type === 'verification_result') return '/safety';
  return null;
}
