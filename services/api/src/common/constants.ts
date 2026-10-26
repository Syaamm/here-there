export const CATEGORIES = ['coffee', 'drinks', 'food', 'sports', 'culture'] as const;
export const STAFF_ROLES = ['support', 'moderator', 'trust_lead', 'admin'] as const;
export const REPORT_CATEGORIES = [
  'harassment',
  'fraud',
  'inappropriate_content',
  'underage',
  'physical_safety',
  'spam',
  'financial_solicitation',
  'immediate_danger',
] as const;
/** Reports that are looked at first and, for immediate danger, tell the on-duty staff at once. */
export const URGENT_CATEGORIES: string[] = ['immediate_danger', 'physical_safety'];
export const REPORT_TARGETS = ['user', 'activity', 'trip', 'message'] as const;
export type Role = 'user' | (typeof STAFF_ROLES)[number];
