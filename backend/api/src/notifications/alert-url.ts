/**
 * Where tapping an alert, or the push notification about it, goes in the app: the exact thing it is about (the warning, the
 * decision, the chat, the one note), not just a page. null: nowhere in particular. This is the same mapping as `alertRoute` in the
 * app (lib/alerts.ts): when one changes, change the other.
 */
export function alertUrl(type: string, data?: Record<string, unknown> | null): string | null {
  const d = (data ?? {}) as Record<string, string | undefined>;
  const q = (v?: string) => encodeURIComponent(v ?? '');
  // "Did you go to ...?": the activity, where the answer is given. The host's note about you, and what became of it, carry the plan they are about and open it.
  if (type === 'attendance_prompt' && d.activityId) return `/activity/${q(d.activityId)}`;
  // a moderator's warning or removed message: what they wrote, with the way to ask for a review under it
  const why = d.reason ? `&reason=${q(d.reason)}` : '';
  const about = d.aboutId ? `&aboutType=${q(d.aboutType)}&aboutId=${q(d.aboutId)}&aboutTitle=${q(d.aboutTitle)}` : '';
  if (type === 'warning' && d.warningId) return `/appeal?kind=warning&targetId=${q(d.warningId)}${why}${about}`;
  if (type === 'message_removed' && d.messageId) return `/appeal?kind=message&targetId=${q(d.messageId)}${why}`;
  // an answer to a review request, or a moderator's message in it: that decision or request, first in its list
  if (type === 'appeal_decided' || type === 'appeal_reply') return d.reportId ? `/reports-blocked?reportId=${q(d.reportId)}` : d.appealId ? `/reports-blocked?appealId=${q(d.appealId)}` : '/reports-blocked';
  if (type === 'report_decision' || type === 'host_absence_decided') return d.reportId ? `/reports-blocked?reportId=${q(d.reportId)}` : '/reports-blocked';
  if (d.conversationId) return `/chat/${q(d.conversationId)}`;
  if (type === 'join_request' && d.activityId) return `/host/${q(d.activityId)}`;
  if (type === 'trip_application' && d.tripId) return `/review/${q(d.tripId)}`;
  if (d.activityId) return `/activity/${q(d.activityId)}`;
  if (d.tripId) return `/trip/${q(d.tripId)}`;
  if (type === 'follow' && d.userId) return `/user/${q(d.userId)}`;
  if (type === 'verification_result') return '/verify';
  return null;
}
