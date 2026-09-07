import { Body, Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { EmailService } from './email.service';
import { InboundEmailDto } from './dto';
import { Public } from '../../common/decorators/public.decorator';

// Webhook endpoint for inbound email. Kept @Public() because the real ingestion
// happens in-process (the IMAP worker calls EmailService.ingest() directly) and
// no human JWT is involved. This HTTP route is ONLY for manual simulations and
// curl tests, so it is protected by a shared secret instead of a JWT:
//
//   POST /api/email/inbound
//   X-Inbound-Secret: <INBOUND_EMAIL_SECRET>
//
// The value must match INBOUND_EMAIL_SECRET exactly (constant-time compare);
// otherwise 401. If that env var is not set, the endpoint rejects everything
// (secure by default). The IMAP worker is NOT affected: it bypasses HTTP.
//
// For a safe way to simulate an inbound email during development/test:
//   curl -X POST http://localhost:4000/api/email/inbound \
//     -H "Content-Type: application/json" \
//     -H "X-Inbound-Secret: $INBOUND_EMAIL_SECRET" \
//     -d '{"fromEmail":"cliente@x.com","subject":"mi consulta","body":"hola"}'
@Controller('email')
export class EmailController {
  constructor(
    private readonly service: EmailService,
    private readonly config: ConfigService,
  ) {}

  private checkSecret(header: string | undefined): void {
    const expected = this.config.get<string>('inboundEmailSecret') || '';
    const received = header ?? '';
    if (!expected || !received) {
      throw new UnauthorizedException('Secreto inválido');
    }
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Secreto inválido');
    }
  }

  @Public()
  @Post('inbound')
  async inbound(
    @Req() req: Request,
    @Body() dto: InboundEmailDto,
  ) {
    this.checkSecret(req.headers['x-inbound-secret'] as string | undefined);
    return this.service.ingest(dto);
  }
}
