export const CATS: Record<string, { label: string; emoji: string }> = {
  coffee: { label: 'Coffee', emoji: '☕' },
  drinks: { label: 'Drinks', emoji: '🍸' },
  food: { label: 'Food', emoji: '🍽️' },
  sports: { label: 'Sports', emoji: '🏃' },
  culture: { label: 'Culture', emoji: '🎨' },
};

/** City-level centres for the map. Only cities listed here have map data in this pilot. */
export const CITY_CENTERS: Record<string, [number, number]> = { milan: [45.4642, 9.19] };

/** Approximate neighbourhood anchors (never a precise address) used when creating an activity in Milan. */
export const MILAN_AREAS: Record<string, [number, number]> = {
  Brera: [45.472, 9.188],
  Centro: [45.4642, 9.19],
  Navigli: [45.45, 9.17],
  Sempione: [45.472, 9.171],
  Isola: [45.4862, 9.1882],
  'Porta Romana': [45.4519, 9.2043],
  'Porta Venezia': [45.4747, 9.2048],
  'Città Studi': [45.4786, 9.2276],
};

export const REPORT_CATEGORIES: [string, string][] = [
  ['harassment', 'Harassment'],
  ['fraud', 'Fraud or scam'],
  ['inappropriate_content', 'Inappropriate content'],
  ['underage', 'Someone may be under 18'],
  ['physical_safety', 'Physical safety concern'],
  ['spam', 'Spam'],
  ['financial_solicitation', 'Asking for money'],
];
