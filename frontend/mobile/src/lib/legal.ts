import { Linking } from 'react-native';
import { API_URL } from './api';

/**
 * The website's legal pages, opened in the phone's browser: the privacy policy and the terms. The site is our own domain in a
 * real build (EXPO_PUBLIC_SHARE_URL); until there is one it is the API's own address, which serves the same pages.
 */
const SITE = (process.env.EXPO_PUBLIC_SHARE_URL || API_URL).replace(/\/+$/, '');

export type LegalPage = 'privacy-policy' | 'terms-and-conditions';

export const legalUrl = (page: LegalPage) => `${SITE}/${page}.html`;

/** Opens the page straight away (no extra question): it is our own site. */
export function openLegal(page: LegalPage) {
  void Linking.openURL(legalUrl(page)).catch(() => undefined);
}
