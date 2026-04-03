// src/chatwoot/chatwoot.service.ts
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { GoogleSheetsService } from '../config/google-sheets.service';
import { HistoryService } from '../history/history.service';

@Injectable()
export class ChatwootService {
  private readonly CHATWOOT_URL = process.env.CHATWOOT_URL;
  private readonly CHATWOOT_TOKEN = process.env.CHATWOOT_TOKEN;

  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly historyService: HistoryService,
  ) {}

  async send(
    accountId: number,
    conversationId: number,
    text: string,
  ): Promise<void> {
    const url = `${this.CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
    try {
      await axios.post(
        url,
        { content: text, message_type: 'outgoing', private: false },
        {
          headers: {
            api_access_token: this.CHATWOOT_TOKEN,
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      console.error(
        '❌ Error Chatwoot:',
        error.response?.data || error.message,
      );
    }
  }

  async handleIAResponse(args: {
    respuesta: string;
    accountId: number;
    conversationId: number;
    contactId: string;
    nombre: string;
    userText: string;
    intent: string;
  }): Promise<{ status: string }> {
    const {
      respuesta,
      accountId,
      conversationId,
      contactId,
      nombre,
      userText,
      intent,
    } = args;

    const offlineTrigger =
      this.sheetsService.getConfig('OFFLINE_TRIGGER') || 'OFFLINE_HUMAN_NEEDED';

    if (respuesta.includes(offlineTrigger)) {
      console.log('🙊 IA requiere humano, silencio.');
      this.historyService.save(contactId, userText, 'SILENCIO');
      this.sheetsService.logInteraction({
        contactId,
        nombre,
        mensaje: userText,
        intent,
        respuesta: 'IA_SOLICITA_HUMANO',
      });
      return { status: 'silence_ia' };
    }

    const header = this.sheetsService.getConfig('BOT_HEADER');
    await this.send(accountId, conversationId, `${header}\n${respuesta}`);

    this.historyService.save(contactId, userText, respuesta);
    this.sheetsService.logInteraction({
      contactId,
      nombre,
      mensaje: userText,
      intent,
      respuesta,
    });

    console.log(`✅ Respuesta enviada [${intent}]`);
    return { status: 'success' };
  }
}
