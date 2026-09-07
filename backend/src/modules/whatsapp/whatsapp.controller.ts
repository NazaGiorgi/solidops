import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { WhatsappService } from './whatsapp.service';
import { Public } from '../../common/decorators/public.decorator';

// Webhook de WhatsApp Cloud API (Meta).
//  - GET: verificación del webhook (challenge de Meta).
//  - POST: recepción de mensajes (chatbot + tickets).
// Ambos son públicos (no requieren JWT); el POST valida la firma X-Hub-Signature-256.
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly service: WhatsappService) {}

  @Public()
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    return this.service.verifyWebhook(mode, verifyToken, challenge, res);
  }

  @Public()
  @Post('webhook')
  receive(@Req() req: Request, @Res() res: Response) {
    return this.service.receive(req, res);
  }
}
