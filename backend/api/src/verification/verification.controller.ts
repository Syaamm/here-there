import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { allowsSimulated } from '../common/demo';
import { signSandbox } from './providers/sandbox.provider';
import { VerificationService } from './verification.service';

const page = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Identity check (sandbox)</title>
<style>body{font-family:system-ui,sans-serif;background:#f7f5f0;color:#14221f;margin:0;padding:20px;max-width:480px;margin-inline:auto;line-height:1.45}
.tag{display:inline-block;background:#f8ecd0;color:#7a5410;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700}
button{display:block;width:100%;min-height:48px;margin:10px 0;border-radius:14px;border:1.5px solid #cfc9bc;background:#fff;font:inherit;font-weight:700;cursor:pointer}
button.go{background:#102f29;color:#fff;border-color:#102f29}</style></head><body>${body}</body></html>`;

/**
 * Provider-facing endpoints. These are public on purpose: they are authenticated by the provider's SIGNATURE,
 * never by a user session.
 */
@Controller('v1/verification')
export class VerificationController {
  constructor(
    private readonly verification: VerificationService,
    private readonly prisma: PrismaService,
  ) {}

  /** Real providers call this with their signed result. The raw body is needed to check the signature. */
  @Public()
  @Post('webhook/:provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>, @Headers() headers: Record<string, string | string[] | undefined>) {
    if (!req.rawBody) throw E.badRequest('INVALID_PAYLOAD', 'Empty webhook body');
    return this.verification.handleWebhook(provider, req.rawBody, headers);
  }

  // ---------------------------------------------------------------- local sandbox provider (development only)
  private async sandboxCheck(ref: string) {
    if (!allowsSimulated() || this.verification.mode !== 'sandbox') throw E.notFound('Page');
    const check = await this.prisma.verificationCheck.findFirst({ where: { providerRef: ref, provider: 'sandbox' } });
    if (!check) throw E.notFound('Verification');
    return check;
  }

  @Public()
  @Get('sandbox/:ref')
  @Header('content-type', 'text/html; charset=utf-8')
  async sandboxPage(@Param('ref') ref: string) {
    const check = await this.sandboxCheck(ref);
    if (check.eligibility !== 'pending') return page('<h2>This check is already finished.</h2><p>You can close this page and go back to the app.</p>');
    return page(`<span class="tag">SANDBOX PROVIDER</span>
<h2>Identity check</h2>
<p>This stands in for a real provider (${check.method === 'document' ? 'a photo of the ID document only: no selfie, no face match' : 'ID photo and a live selfie'}). <b>Nothing is photographed or uploaded.</b> Choose what the provider should report:</p>
<form method="post" action="/v1/verification/sandbox/${encodeURIComponent(ref)}/decide">
<button class="go" name="outcome" value="approve">${check.method === 'document' ? 'Approve: adult, genuine ID' : 'Approve: adult, genuine ID, selfie matches'}</button>
<button name="outcome" value="decline">Decline: document unreadable</button>
${check.method === 'document' ? '' : '<button name="outcome" value="liveness">Decline: liveness check failed</button>'}
<button name="outcome" value="underage">Report: person is under 18</button>
</form>`);
  }

  /** Builds a signed webhook exactly like a vendor would, and sends it through the real webhook handler. */
  @Public()
  @Post('sandbox/:ref/decide')
  @Header('content-type', 'text/html; charset=utf-8')
  async sandboxDecide(@Param('ref') ref: string, @Body() body: { outcome?: string } | undefined) {
    await this.sandboxCheck(ref);
    const payloads: Record<string, object> = {
      approve: { status: 'approved', adult: true },
      underage: { status: 'approved', adult: false },
      decline: { status: 'declined', reason: 'document' },
      liveness: { status: 'declined', reason: 'liveness' },
    };
    const picked = payloads[body?.outcome ?? ''];
    if (!picked) throw E.badRequest('INVALID_PAYLOAD', 'Unknown outcome');
    const raw = Buffer.from(JSON.stringify({ providerRef: ref, ...picked }));
    await this.verification.handleWebhook('sandbox', raw, { 'x-sandbox-signature': signSandbox(raw) });
    return page('<span class="tag">SANDBOX PROVIDER</span><h2>Done</h2><p>The result was sent to HERE &amp; THERE. You can close this page and go back to the app.</p>');
  }
}
