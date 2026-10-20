import { randomUUID } from 'node:crypto';
import { E } from '../../common/errors';
import type { IdentityProvider } from './types';

/**
 * No external provider: staff decide in the admin console ("manual"), or the check passes instantly ("auto",
 * local demos only). Nothing is photographed or uploaded.
 */
export class ManualProvider implements IdentityProvider {
  constructor(readonly name: 'manual' | 'auto') {}

  async createSession() {
    return { providerRef: `${this.name}_${randomUUID()}` };
  }

  parseWebhook(): never {
    throw E.notFound('Webhook');
  }
}
