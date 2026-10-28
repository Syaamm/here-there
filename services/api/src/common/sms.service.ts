import { Injectable } from '@nestjs/common';
import { isDemo } from './demo';

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
    return process.env.EMAIL_DEV_ECHO === 'true' || isDemo(); // the same switches as email; refused in production by EmailService unless it is a demo
  }

  async send(to: string, text: string) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (sid && token && from) {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: from, Body: text }),
      });
      if (!res.ok) throw new Error(`SMS provider returned ${res.status}`);
      return;
    }
    if (process.env.NODE_ENV === 'test') {
      this.outbox.push({ to, text });
      return;
    }
    console.log(`\n[dev sms] to: ${to}\n[dev sms] ${text}\n`);
  }
}
