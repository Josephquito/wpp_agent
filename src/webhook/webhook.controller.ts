// src/webhook/webhook.controller.ts
import {
  Controller,
  Post,
  Body,
  Get,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { GoogleSheetsService } from '../config/google-sheets.service';

@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly sheetsService: GoogleSheetsService,
  ) {}

  @Post()
  async receiveMessage(@Body() body: any): Promise<{ status: string }> {
    if (body?.event !== 'message_created') return { status: 'ignored' };

    if (body?.message_type === 'outgoing') {
      const esBot =
        body?.sender?.name === 'Chatwoot' &&
        body?.content_attributes?.external_echo !== true;
      if (esBot) return { status: 'ignored' };
      return this.webhookService.handleAgentMessage(body);
    }

    if (body?.message_type !== 'incoming') return { status: 'ignored' };
    return this.webhookService.handleIncomingMessage(body);
  }

  @Get('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshCache(): Promise<{ message: string }> {
    await this.sheetsService.refreshCache();
    return { message: '✅ Caché actualizada.' };
  }
}
