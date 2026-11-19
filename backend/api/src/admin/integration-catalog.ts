/**
 * Everything Settings > Integrations can hold: the kinds of service, the providers of each, and the details each provider asks for.
 * `env` is the server setting (.env) the same detail replaces while that integration is on, so the app behaves the same way
 * whether a value comes from here or from .env. A `hidden` field is not asked for: its default is saved with the integration
 * (the host and port of a known email provider). The console builds its pop-up from this list.
 */
export type Field = {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  multiline?: boolean;
  hidden?: boolean;
  placeholder?: string;
  /** a fixed list of answers: [value, label] */
  options?: [string, string][];
  default?: string;
  /** the .env setting this detail stands in for */
  env?: string;
};
export type Provider = { id: string; label: string; blurb?: string; fields: Field[] };
export type KindInfo = { label: string; blurb: string; providers: Provider[] };

export const INTEGRATION_KINDS = ['email', 'sms', 'verification'] as const;
export type Kind = (typeof INTEGRATION_KINDS)[number];

const YES_NO: [string, string][] = [
  ['true', 'Yes'],
  ['false', 'No'],
];
const SHOW_CODE: Field = { key: 'showCode', label: 'Show code in app', options: YES_NO, default: 'true' };
const FIXED_CODE: Field = { key: 'fixedCode', label: 'Fixed code', optional: true, placeholder: 'Enter 6-digit code', default: '123456' };
const ENFORCES_18 = (env: string): Field => ({ key: 'enforces18', label: 'Refuses under-18s', optional: true, options: [['', 'Not set'], ...YES_NO], env });
const REDACT = (env: string): Field => ({ key: 'redact', label: 'After the check', optional: true, options: [['true', 'Delete personal data'], ['false', 'Keep it (testing only)']], default: 'true', env });

/** Any email service that speaks SMTP works: the known ones only need their login, the host and port are filled in for them. */
const smtp = (id: string, label: string, host: string, login: Field | { fixed: string }, secret: string): Provider => ({
  id,
  label,
  fields: [
    { key: 'host', label: 'Host', hidden: true, default: host },
    { key: 'port', label: 'Port', hidden: true, default: '587' },
    'fixed' in login ? { key: 'username', label: 'Username', hidden: true, default: login.fixed } : login,
    { key: 'password', label: secret, secret: true, placeholder: `Enter ${secret.toLowerCase()}` },
    { key: 'from', label: 'From email', placeholder: 'Enter sender, e.g. LAMIS <no-reply@yourdomain.com>', env: 'EMAIL_FROM' },
  ],
});
const LOGIN = (label: string): Field => ({ key: 'username', label, placeholder: `Enter ${label.toLowerCase()}` });

export const CATALOG: Record<Kind, KindInfo> = {
  email: {
    label: 'Email',
    blurb: 'Sign-up codes and notification emails',
    providers: [
      { id: 'dev', label: 'Test mode', blurb: 'Nothing is sent', fields: [FIXED_CODE, SHOW_CODE] },
      smtp('brevo', 'Brevo', 'smtp-relay.brevo.com', LOGIN('SMTP login'), 'SMTP key'),
      smtp('sendgrid', 'SendGrid', 'smtp.sendgrid.net', { fixed: 'apikey' }, 'API key'),
      smtp('mailgun', 'Mailgun', 'smtp.mailgun.org', LOGIN('SMTP username'), 'SMTP password'),
      smtp('resend', 'Resend', 'smtp.resend.com', { fixed: 'resend' }, 'API key'),
      smtp('gmail', 'Gmail', 'smtp.gmail.com', LOGIN('Email'), 'App password'),
      {
        id: 'smtp',
        label: 'Custom SMTP',
        fields: [
          { key: 'host', label: 'Host', placeholder: 'Enter host, e.g. smtp.example.com' },
          { key: 'port', label: 'Port', placeholder: 'Enter port', default: '587' },
          { key: 'username', label: 'Username', optional: true, placeholder: 'Enter username' },
          { key: 'password', label: 'Password', secret: true, optional: true, placeholder: 'Enter password' },
          { key: 'from', label: 'From email', placeholder: 'Enter sender, e.g. LAMIS <no-reply@yourdomain.com>', env: 'EMAIL_FROM' },
        ],
      },
    ],
  },
  sms: {
    label: 'SMS',
    blurb: 'The optional mobile-number check',
    providers: [
      { id: 'dev', label: 'Test mode', blurb: 'Nothing is sent', fields: [FIXED_CODE, SHOW_CODE] },
      {
        id: 'twilio',
        label: 'Twilio',
        fields: [
          { key: 'accountSid', label: 'Account SID', placeholder: 'Enter account SID', env: 'TWILIO_ACCOUNT_SID' },
          { key: 'authToken', label: 'Auth token', secret: true, placeholder: 'Enter auth token', env: 'TWILIO_AUTH_TOKEN' },
          { key: 'from', label: 'From number', placeholder: 'Enter from number', env: 'TWILIO_FROM' },
        ],
      },
      {
        id: 'telnyx',
        label: 'Telnyx',
        fields: [
          { key: 'apiKey', label: 'API key', secret: true, placeholder: 'Enter API key' },
          { key: 'from', label: 'From number', placeholder: 'Enter from number' },
        ],
      },
      {
        id: 'infobip',
        label: 'Infobip',
        fields: [
          { key: 'baseUrl', label: 'Base URL', placeholder: 'Enter base URL, e.g. xxxxx.api.infobip.com' },
          { key: 'apiKey', label: 'API key', secret: true, placeholder: 'Enter API key' },
          { key: 'from', label: 'Sender', placeholder: 'Enter sender name or number' },
        ],
      },
      {
        id: 'msg91',
        label: 'MSG91',
        fields: [
          { key: 'authKey', label: 'Auth key', secret: true, placeholder: 'Enter auth key' },
          { key: 'templateId', label: 'Template ID', placeholder: 'Enter template ID' },
          { key: 'otpVariable', label: 'Code variable', optional: true, placeholder: 'OTP', default: 'OTP' },
        ],
      },
      {
        id: 'vonage',
        label: 'Vonage',
        fields: [
          { key: 'apiKey', label: 'API key', placeholder: 'Enter API key' },
          { key: 'apiSecret', label: 'API secret', secret: true, placeholder: 'Enter API secret' },
          { key: 'from', label: 'From', placeholder: 'Enter sender name or number' },
        ],
      },
      {
        id: 'plivo',
        label: 'Plivo',
        fields: [
          { key: 'authId', label: 'Auth ID', placeholder: 'Enter auth ID' },
          { key: 'authToken', label: 'Auth token', secret: true, placeholder: 'Enter auth token' },
          { key: 'from', label: 'From number', placeholder: 'Enter from number' },
        ],
      },
      {
        id: 'sinch',
        label: 'Sinch',
        fields: [
          { key: 'servicePlanId', label: 'Service plan ID', placeholder: 'Enter service plan ID' },
          { key: 'apiToken', label: 'API token', secret: true, placeholder: 'Enter API token' },
          { key: 'from', label: 'From number', placeholder: 'Enter from number' },
          { key: 'region', label: 'Region', options: [['us', 'United States'], ['eu', 'Europe'], ['au', 'Australia'], ['ca', 'Canada'], ['br', 'Brazil']], default: 'us' },
        ],
      },
    ],
  },
  verification: {
    label: 'Identity verification',
    blurb: 'How the 18+ identity check is done',
    providers: [
      { id: 'manual', label: 'Manual Review', blurb: 'Applications go to the admin, who approves or rejects them', fields: [] },
      {
        id: 'persona',
        label: 'Persona',
        fields: [
          { key: 'apiKey', label: 'API key', secret: true, placeholder: 'Enter API key', env: 'PERSONA_API_KEY' },
          { key: 'webhookSecret', label: 'Webhook secret', secret: true, placeholder: 'Enter webhook secret', env: 'PERSONA_WEBHOOK_SECRET' },
          { key: 'templateId', label: 'Template ID', placeholder: 'Enter template ID', env: 'PERSONA_TEMPLATE_ID' },
          { key: 'templateIdDocument', label: 'ID-only template ID', optional: true, placeholder: 'Enter template ID', env: 'PERSONA_TEMPLATE_ID_DOCUMENT' },
          { key: 'redirectUri', label: 'Return URL', optional: true, placeholder: 'Enter return URL', env: 'PERSONA_REDIRECT_URI' },
          ENFORCES_18('PERSONA_TEMPLATE_ENFORCES_18'),
          REDACT('PERSONA_REDACT'),
        ],
      },
      {
        id: 'veriff',
        label: 'Veriff',
        fields: [
          { key: 'apiKey', label: 'API key', secret: true, placeholder: 'Enter API key', env: 'VERIFF_API_KEY' },
          { key: 'apiSecret', label: 'API secret', secret: true, placeholder: 'Enter API secret', env: 'VERIFF_API_SECRET' },
          { key: 'redirectUri', label: 'Return URL', optional: true, placeholder: 'Enter return URL', env: 'VERIFF_REDIRECT_URI' },
          ENFORCES_18('VERIFF_ENFORCES_18'),
          REDACT('VERIFF_REDACT'),
        ],
      },
      {
        id: 'idenfy',
        label: 'iDenfy',
        fields: [
          { key: 'apiKey', label: 'API key', secret: true, placeholder: 'Enter API key', env: 'IDENFY_API_KEY' },
          { key: 'apiSecret', label: 'API secret', secret: true, placeholder: 'Enter API secret', env: 'IDENFY_API_SECRET' },
          { key: 'webhookSecret', label: 'Webhook secret', secret: true, placeholder: 'Enter webhook secret', env: 'IDENFY_WEBHOOK_SECRET' },
          { key: 'redirectUri', label: 'Return URL', optional: true, placeholder: 'Enter return URL', env: 'IDENFY_REDIRECT_URI' },
          ENFORCES_18('IDENFY_ENFORCES_18'),
          REDACT('IDENFY_REDACT'),
        ],
      },
    ],
  },
};

export const providerOf = (kind: Kind, id: string) => CATALOG[kind].providers.find((p) => p.id === id);
/** The test-only pieces: refused on a real production server (a demo server may use them). */
export const SIMULATED = new Set(['email:dev', 'sms:dev']);
