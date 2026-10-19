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
] as const;
export const REPORT_TARGETS = ['user', 'activity', 'trip', 'message'] as const;
export type Role = 'user' | (typeof STAFF_ROLES)[number];
