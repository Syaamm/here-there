export const CATS: Record<string, { label: string; emoji: string }> = {
  coffee: { label: 'Coffee', emoji: '☕' },
  drinks: { label: 'Drinks', emoji: '🍸' },
  food: { label: 'Food', emoji: '🍽️' },
  sports: { label: 'Sports', emoji: '🏃' },
  culture: { label: 'Culture', emoji: '🎨' },
};

/** Soft, green-led tints for activity cards (stand-ins until real venue photos exist). Never the only cue: text labels carry the meaning. */
export const CAT_COLORS: Record<string, string> = {
  coffee: '#C7D9BF',
  drinks: '#86C4A8',
  food: '#DCE5B8',
  sports: '#79B0A6',
  culture: '#C8C2E2',
};
export const catColor = (cat: string) => CAT_COLORS[cat] ?? '#CFE0D6';

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
  ['immediate_danger', 'Someone is in danger right now'],
  ['harassment', 'Harassment'],
  ['fraud', 'Fraud or scam'],
  ['inappropriate_content', 'Inappropriate content'],
  ['underage', 'Someone may be under 18'],
  ['physical_safety', 'Physical safety concern'],
  ['spam', 'Spam'],
  ['financial_solicitation', 'Asking for money'],
];

export const LANGUAGES = ['English', 'Italian', 'French', 'Spanish', 'German', 'Portuguese', 'Dutch', 'Arabic'];
export const INTERESTS = ['coffee', 'culture', 'travel', 'running', 'food', 'music', 'art', 'hiking', 'photography', 'nightlife', 'sports', 'books'];

export const TRIP_TAGS = ['culture', 'food', 'adventure', 'nature', 'city', 'beach', 'relax', 'hiking', 'photography', 'art'];
export const GROUP_SIZES: [string, string][] = [
  ['2-3', '2–3 people'],
  ['4-6', '4–6 people'],
  ['7-10', '7–10 people'],
  ['10+', '10+ people'],
];
export const FLEX: [string, string][] = [
  ['exact', 'Exact dates'],
  ['plus_minus_1', '± 1 day'],
  ['plus_minus_3', '± 3 days'],
  ['plus_minus_7', '± 7 days'],
  ['same_month', 'Anytime that month'],
];
export const EXPERIENCE: [string, string][] = [
  ['beginner', 'Beginner'],
  ['intermediate', 'Intermediate'],
  ['experienced', 'Experienced'],
];

/** One photo per category (webp, ~30 KB each). Decorative: the category is always also named in text. */
export const CAT_IMAGES: Record<string, number> = {
  coffee: require('../../assets/categories/coffee.webp'),
  drinks: require('../../assets/categories/drinks.webp'),
  food: require('../../assets/categories/food.webp'),
  sports: require('../../assets/categories/sports.webp'),
  culture: require('../../assets/categories/culture.webp'),
};
