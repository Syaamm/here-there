/**
 * The alerts that mean a request of yours changed its status (approved, declined, moved up the waiting list, removed). When one arrives the
 * lists and the counts that depend on requests (Profile, My activities: Pending, Rejected) are asked again at once, so a number never
 * waits for the next pull-to-refresh.
 */
export const REQUEST_ALERTS = new Set(['request_approved', 'request_declined', 'waitlist_promoted', 'removed', 'spot_opened']);
