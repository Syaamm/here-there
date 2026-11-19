import { Injectable } from '@nestjs/common';
import { allowsSimulated, isDemo } from './demo';
import { activeIntegration, setting } from './integration-config';
import { SMS_SENDERS } from './sms-providers';

/**
 * Text messages for the optional mobile-number check.
 *
 *   TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM set -> real SMS through Twilio
 *   NODE_ENV=test                                           -> kept in `outbox` for tests
 *   otherwise (dev)                                         -> printed in the API console
 */
@Injectable()
export class SmsService {
  readonly outbox: { to: string; text: string }[] = [];

  get devEcho() {
    const on = activeIntegration('sms'); // Settings > Integrations decides while one is on
    if (on) return (isDemo() || allowsSimulated()) && on.provider === 'dev' && (on.values.showCode ?? 'true') === 'true';
    return process.env.EMAIL_DEV_ECHO === 'true' || isDemo(); // the same switches as email; refused in production by EmailService unless it is a demo
  }

  async send(to: string, text: string) {
    const on = activeIntegration('sms');
    if (on && SMS_SENDERS[on.provider]) return SMS_SENDERS[on.provider](to, text, on.values); // MSG91, Vonage, Plivo, Sinch
    const sid = setting('sms', 'TWILIO_ACCOUNT_SID');
    const token = setting('sms', 'TWILIO_AUTH_TOKEN');
    const from = setting('sms', 'TWILIO_FROM');
    if (sid && token && from) {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: from, Body: text }),
      });
      if (!res.ok) throw new Error(`SMS provider returned ${res.status}`);
      return;
    }
    if (process.env.NODE_ENV === 'test' && !activeIntegration('sms')) {
      this.outbox.push({ to, text });
      return;
    }
    console.log(`\n[dev sms] to: ${to}\n[dev sms] ${text}\n`);
  }
}
