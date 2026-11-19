/**
 * The text-message services an admin can switch on in Settings > Integrations (besides Twilio, which SmsService sends itself).
 * Each one is a plain HTTPS call. A provider's answer can name a number or hold a key, so on a failure only the status is kept.
 */
type Values = Record<string, string>;
type Send = (to: string, text: string, v: Values) => Promise<void>;

const noPlus = (n: string) => n.replace(/^\+/, '');

async function http(name: string, url: string, init: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error(`${name}: the service could not be reached`);
  }
  if (!res.ok) throw new Error(`${name} returned ${res.status}`);
  return res.json().catch(() => ({})) as Promise<any>;
}

export const SMS_SENDERS: Record<string, Send> = {
  /** MSG91 "Flow": a saved template with a variable for the code (DLT-registered in India). The code is taken out of the message. */
  async msg91(to, text, v) {
    const code = /\b\d{6}\b/.exec(text)?.[0];
    if (!code) throw new Error('MSG91: the message holds no code to send');
    const out = await http('MSG91', 'https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { authkey: v.authKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ template_id: v.templateId, short_url: '0', recipients: [{ mobiles: noPlus(to), [v.otpVariable || 'OTP']: code }] }),
    });
    if (out?.type === 'error') throw new Error('MSG91 refused the message');
  },

  /** Vonage (Nexmo) SMS API. */
  async vonage(to, text, v) {
    const out = await http('Vonage', 'https://rest.nexmo.com/sms/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: v.apiKey, api_secret: v.apiSecret, to: noPlus(to), from: v.from, text }),
    });
    const status = out?.messages?.[0]?.status;
    if (status !== undefined && String(status) !== '0') throw new Error(`Vonage refused the message (status ${status})`);
  },

  /** Plivo Message API. */
  async plivo(to, text, v) {
    await http('Plivo', `https://api.plivo.com/v1/Account/${encodeURIComponent(v.authId)}/Message/`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${v.authId}:${v.authToken}`).toString('base64'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ src: noPlus(v.from), dst: noPlus(to), text }),
    });
  },

  /** Telnyx Messaging API. */
  async telnyx(to, text, v) {
    await http('Telnyx', 'https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${v.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: v.from, to: to.startsWith('+') ? to : `+${to}`, text }),
    });
  },

  /** Infobip SMS API. The base URL is the account's own address (xxxxx.api.infobip.com). */
  async infobip(to, text, v) {
    const host = v.baseUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) throw new Error('Infobip: the base URL is not valid');
    await http('Infobip', `https://${host}/sms/2/text/advanced`, {
      method: 'POST',
      headers: { Authorization: `App ${v.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ messages: [{ from: v.from, destinations: [{ to: noPlus(to) }], text }] }),
    });
  },

  /** Sinch SMS (REST "batches"). */
  async sinch(to, text, v) {
    const region = ['us', 'eu', 'au', 'ca', 'br'].includes(v.region) ? v.region : 'us';
    await http('Sinch', `https://${region}.sms.api.sinch.com/xms/v1/${encodeURIComponent(v.servicePlanId)}/batches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${v.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: v.from, to: [to.startsWith('+') ? to : `+${to}`], body: text }),
    });
  },
};
