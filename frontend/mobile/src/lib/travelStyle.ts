import { t } from './i18n';

/** A trip that meets at the destination (no departure city): everyone travels on their own. */
export const meetsThere = (trip: { travelStyle?: string; originCity: string }) => trip.travelStyle === 'meet_at_destination' || !trip.originCity.trim();

/** "From Rome", or "Meet at destination": how the group gets there, in a few words. */
export const tripFrom = (trip: { travelStyle?: string; originCity: string }) => (meetsThere(trip) ? t('Meet at destination') : t('From {city}', { city: trip.originCity }));
