import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { allowsSimulated, isDemo } from './demo';
import { activeIntegration } from './integration-config';

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
    const on = activeIntegration('email'); // Settings > Integrations decides while one is on
    if (on) return (isDemo() || allowsSimulated()) && on.provider === 'dev' && (on.values.showCode ?? 'true') === 'true';
    return process.env.EMAIL_DEV_ECHO === 'true' || isDemo();
  }

  private smtp: { key: string; transport: nodemailer.Transporter } | null = null;
  /** The SMTP connection of the email integration that is on, rebuilt only when its details change. */
  private integrationTransport() {
    const on = activeIntegration('email');
    if (!on || on.provider === 'dev' || !on.values.host) return null;
    const v = on.values;
    const key = JSON.stringify(v);
    if (this.smtp?.key !== key) {
      const port = Number(v.port) || 587;
      this.smtp = { key, transport: nodemailer.createTransport({ host: v.host, port, secure: port === 465, ...(v.username ? { auth: { user: v.username, pass: v.password ?? '' } } : {}) }) };
    }
    return { transport: this.smtp.transport, from: v.from || undefined };
  }

  async send(to: string, subject: string, text: string) {
    const integration = this.integrationTransport();
    if (integration) {
      await integration.transport.sendMail({ from: integration.from ?? process.env.EMAIL_FROM ?? 'LAMIS <no-reply@herethere.local>', to, subject, text });
      return;
    }
    if (activeIntegration('email')?.provider === 'dev' && process.env.NODE_ENV !== 'test') {
      console.log(`
[dev email] to: ${to}
[dev email] subject: ${subject}
${text}
`); // test mode: never delivered
      return;
    }
    if (this.transporter) {
      await this.transporter.sendMail({ from: process.env.EMAIL_FROM ?? 'LAMIS <no-reply@herethere.local>', to, subject, text });
      return;
    }
    if (process.env.NODE_ENV === 'test') {
      this.outbox.push({ to, subject, text });
      return;
    }
    console.log(`\n[dev email] to: ${to}\n[dev email] subject: ${subject}\n${text}\n`);
  }
}
