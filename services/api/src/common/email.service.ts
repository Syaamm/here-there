import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { isDemo } from './demo';

/**
 * Transactional email (verification codes now; notifications later).
 *
 *   SMTP_URL set      -> real delivery through any SMTP provider (e.g. smtps://user:pass@smtp.example.com)
 *   NODE_ENV=test     -> messages are kept in `outbox` so tests can read them
 *   otherwise (dev)   -> the message is printed in the API console
 *
 * EMAIL_DEV_ECHO=true additionally lets the API hand the code back to the app, so a phone can complete the
 * flow without a mail server. It is refused in production.
 */
@Injectable()
export class EmailService {
  readonly outbox: { to: string; subject: string; text: string }[] = [];
  private readonly transporter = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      if (process.env.EMAIL_DEV_ECHO === 'true' && !isDemo()) throw new Error('EMAIL_DEV_ECHO must not be enabled in production (set DEMO_MODE=true only for a demo with made-up data)');
      if (!process.env.SMTP_URL) console.warn('SMTP_URL is not set: verification emails cannot be delivered in production');
    }
  }

  get devEcho() {
    return process.env.EMAIL_DEV_ECHO === 'true' || isDemo();
  }

  async send(to: string, subject: string, text: string) {
    if (this.transporter) {
      await this.transporter.sendMail({ from: process.env.EMAIL_FROM ?? 'HERE & THERE <no-reply@herethere.local>', to, subject, text });
      return;
    }
    if (process.env.NODE_ENV === 'test') {
      this.outbox.push({ to, subject, text });
      return;
    }
    console.log(`\n[dev email] to: ${to}\n[dev email] subject: ${subject}\n${text}\n`);
  }
}
