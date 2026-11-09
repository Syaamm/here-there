/**
 * The pages whose static header is the shared curved band (back button + title on deep forest, the page rising over it as a
 * sheet). Keyed by the route's name; the value is the English title (translated where it is drawn). Screen reads this, so a
 * page opts in by being listed here.
 */
export const PAGE_TITLES: Record<string, string> = {
  'join/[id]': 'Request to join',
  'apply/[id]': 'Apply to join',
  'host/[id]': 'Manage join requests',
  'review/[id]': 'Review travelers',
  'user/[id]': 'Profile',
  safety: 'Safety & privacy',
  settings: 'Settings',
  activities: 'All activities',
  trips: 'All trips',
  'edit-profile': 'Edit profile',
  'change-password': 'Change password',
  'my-data': 'Your data',
  retention: 'How long we keep things',
  reliability: 'Your reliability',
  'no-shows/[kind]/[id]': 'Who came?',
  'change-email': 'Change email',
  'delete-account': 'Delete account',
  'my-activities': 'My activities',
  'my-trips': 'My trips',
  drafts: 'My drafts',
  'notification-settings': 'Notifications',
  'reports-blocked': 'Reports & blocked',
  'travel-match': 'Travel buddies',
  'trip-plan/[id]': 'Trip plan',
  appeal: 'Ask for a review',
  favourites: 'Favourites',
  connections: 'Friends',
  verify: 'Verify your identity',
};

/** Of those pages, the ones that use the plain Figma header (round back button + centred title on the page's own background) instead of the band: Settings and every page inside it, Request to join and All activities (HERE), Apply to join and All trips (THERE). */
export const PLAIN_PAGES = new Set<string>([
  'join/[id]', 'activities', 'apply/[id]', 'trips',
  'settings', 'safety', 'edit-profile', 'change-password', 'change-email', 'delete-account', 'my-data', 'retention', 'reliability',
  'notification-settings', 'reports-blocked', 'travel-match', 'appeal', 'verify',
  'host/[id]', 'review/[id]', 'user/[id]', 'my-activities', 'my-trips', 'drafts', 'trip-plan/[id]', 'favourites', 'connections', 'no-shows/[kind]/[id]',
]);
