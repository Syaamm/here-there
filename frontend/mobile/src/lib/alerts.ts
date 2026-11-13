import type { Notif } from './api';

/**
 * What an alert says in the list: for the ones whose detail opens when they are tapped (a moderator's decision, a host's note,
 * identity checks), always the same short title and line, whatever older, longer text was stored with them. Others: as sent.
 */
export function alertText(n: Pick<Notif, 'type' | 'title' | 'body' | 'data'>, t: (s: string, v?: Record<string, string | number>) => string): { title: string; body: string } {
  switch (n.type) {
    case 'warning': {
      // when it is about a plan, the alert says which one
      const about = (n as { data?: { aboutTitle?: string } | null }).data?.aboutTitle;
      return { title: t('A moderator warned you'), body: about ? t('{title} · Tap to read why.', { title: about }) : t('Tap to read why. You can ask for a review.') };
    }
    case 'message_removed':
      return { title: t('A moderator removed your message'), body: t('Tap to read why. You can ask for a review.') };
    case 'report_decision':
      return { title: t('Action taken on a report about you'), body: t('Tap to see the decision. You can ask for a review.') };
    case 'attendance_prompt':
      return { title: n.title, body: t('Tap to answer.') };
    case 'host_absence_reported':
      return { title: n.title, body: t('A moderator will look at it.') };
    case 'host_absence_decided':
      return { title: n.title, body: t('Tap to ask for a review.') };
    case 'attendance_marked':
      return { title: t("The host says you didn't come"), body: t('Tap to see it or dispute it.') };
    case 'attendance_decided':
      return { title: n.title, body: t('Tap to see the details.') };
    case 'appeal_decided':
      return { title: n.title, body: t('Tap to see the answer.') };
    case 'appeal_reply':
      return { title: n.title, body: n.body };
    default:
      return { title: n.title, body: n.body };
  }
}

/** Where tapping an alert goes (null: nowhere, it is only information). The page itself flips to its own product (useEnterMode). */
export function alertRoute(n: Pick<Notif, 'type' | 'data'>): string | null {
  const d = n.data;
  // "Did you go to …?": the activity itself, where the answer is given; the host's notes about you: Your reliability
  if (n.type === 'attendance_prompt' && d?.activityId) return `/activity/${d.activityId}`;
  // the host's note about you, or what became of it: its alert carries the plan it is about, so it opens that plan (below); there the note and the way to dispute it are shown
  const ids = d as { reportId?: string; appealId?: string } | null;
  // a moderator's warning or removed message: the page shows what the moderator wrote, with the way to ask for a review under it
  const reason = (d as { reason?: string } | null)?.reason;
  const why = reason ? `&reason=${encodeURIComponent(reason)}` : '';
  // a warning about a plan: the page names it and can open it
  const plan = d as { aboutType?: string; aboutId?: string; aboutTitle?: string } | null;
  const about = plan?.aboutId ? `&aboutType=${plan.aboutType}&aboutId=${plan.aboutId}&aboutTitle=${encodeURIComponent(plan.aboutTitle ?? '')}` : '';
  if (n.type === 'warning' && d?.warningId) return `/appeal?kind=warning&targetId=${d.warningId}${why}${about}`;
  if (n.type === 'message_removed' && d?.messageId) return `/appeal?kind=message&targetId=${d.messageId}${why}`;
  // a review request's answer or a moderator's message: the list, with that exact request first and marked
  if (n.type === 'appeal_decided' || n.type === 'appeal_reply') return ids?.reportId ? `/reports-blocked?reportId=${ids.reportId}` : ids?.appealId ? `/reports-blocked?appealId=${ids.appealId}` : '/reports-blocked';
  // a decision about you: the list, with that exact decision first and marked
  if (n.type === 'report_decision' || n.type === 'host_absence_decided') return ids?.reportId ? `/reports-blocked?reportId=${ids.reportId}` : '/reports-blocked';
  if (d?.conversationId) return `/chat/${d.conversationId}`;
  if (n.type === 'join_request' && d?.activityId) return `/host/${d.activityId}`;
  if (n.type === 'trip_application' && d?.tripId) return `/review/${d.tripId}`;
  if (d?.activityId) return `/activity/${d.activityId}`;
  if (d?.tripId) return `/trip/${d.tripId}`;
  if (n.type === 'follow' && (d as { userId?: string } | null)?.userId) return `/user/${(d as { userId: string }).userId}`;
  if (n.type === 'verification_result') return '/verify';
  return null;
}
