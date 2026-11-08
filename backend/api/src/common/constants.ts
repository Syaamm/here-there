export const CATEGORIES = ['coffee', 'drinks', 'food', 'sports', 'culture'] as const;
/** Two kinds of console account: an admin (everything, everywhere) and staff (only their area, only the parts an admin allows). */
export const STAFF_ROLES = ['staff', 'admin'] as const;
/** The parts of the console an admin can switch on or off for each staff member. */
export const STAFF_PERMISSIONS = ['reports', 'verification', 'users', 'content'] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];
export const REPORT_CATEGORIES = [
  'harassment',
  'fraud',
  'inappropriate_content',
  'underage',
  'physical_safety',
  'spam',
  'financial_solicitation',
  'immediate_danger',
  'host_no_show', // a member says the host never came: only members of that plan can send it (see reliability.controller.ts)
] as const;
/** Reports that are looked at first and, for immediate danger, tell the on-duty staff at once. */
export const URGENT_CATEGORIES: string[] = ['immediate_danger', 'physical_safety'];
export const REPORT_TARGETS = ['user', 'activity', 'trip', 'message'] as const;
export type Role = 'user' | 'guest' | (typeof STAFF_ROLES)[number];
