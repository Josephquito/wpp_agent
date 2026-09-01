// src/webhook/webhook.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  // ── Verificación inicial del webhook (Meta la llama UNA vez al configurarlo) ──
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verificado por Meta');
      return res.status(HttpStatus.OK).send(challenge);
    }

    console.log('❌ Verificación de webhook fallida — token no coincide');
    return res.status(HttpStatus.FORBIDDEN).send('Forbidden');
  }

  // ── Recepción de mensajes/eventos de WhatsApp ──
  @Post()
  async receiveMessage(@Body() body: any): Promise<{ status: string }> {
    return this.webhookService.handleIncomingMessage(body);
  }
}
