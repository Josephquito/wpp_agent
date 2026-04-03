import { Injectable } from '@nestjs/common';
import { GoogleSheetsService } from '../../config/google-sheets.service';
import { HistoryService } from '../../history/history.service';
import { OpenaiService } from '../../openai/openai.service';
import { ChatwootService } from '../../chatwoot/chatwoot.service';

@Injectable()
export class InfoHandler {
  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly historyService: HistoryService,
    private readonly openaiService: OpenaiService,
    private readonly chatwoot: ChatwootService,
  ) {}

  async handle(args: {
    userText: string;
    productos: string[];
    contactId: string;
    nombre: string;
    accountId: number;
    conversationId: number;
    history: string;
  }): Promise<{ status: string }> {
    const {
      userText,
      productos,
      contactId,
      nombre,
      accountId,
      conversationId,
      history,
    } = args;

    const contexto = this.sheetsService.findInfo(userText, productos);

    if (!contexto) {
      console.log('🙊 INFO: sin contexto en BD, silencio.');
      this.historyService.save(contactId, userText, 'SILENCIO');
      this.sheetsService.logInteraction({
        contactId,
        nombre,
        mensaje: userText,
        intent: 'INFO',
        respuesta: 'SIN_CONTEXTO_BD',
      });
      return { status: 'silence' };
    }

    const respuesta = await this.openaiService.generateResponse({
      intent: 'INFO',
      userMessage: userText,
      context: contexto,
      history,
    });

    return this.chatwoot.handleIAResponse({
      respuesta,
      accountId,
      conversationId,
      contactId,
      nombre,
      userText,
      intent: 'INFO',
    });
  }
}
