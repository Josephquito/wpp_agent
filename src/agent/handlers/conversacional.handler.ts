import { Injectable } from '@nestjs/common';
import { GoogleSheetsService } from '../../config/google-sheets.service';
import { HistoryService } from '../../history/history.service';
import { OpenaiService } from '../../openai/openai.service';
import { ChatwootService } from '../../chatwoot/chatwoot.service';

@Injectable()
export class ConversacionalHandler {
  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly historyService: HistoryService,
    private readonly openaiService: OpenaiService,
    private readonly chatwoot: ChatwootService,
  ) {}

  async handle(args: {
    contactId: string;
    nombre: string;
    userText: string;
    accountId: number;
    conversationId: number;
    history: string;
  }): Promise<{ status: string }> {
    const { contactId, nombre, userText, accountId, conversationId, history } =
      args;

    const respuesta = await this.openaiService.generateResponse({
      intent: 'CONVERSACIONAL',
      userMessage: userText,
      context: '',
      history,
    });

    const header = this.sheetsService.getConfig('BOT_HEADER');
    await this.chatwoot.send(
      accountId,
      conversationId,
      `${header}\n${respuesta}`,
    );

    this.historyService.save(contactId, userText, respuesta);
    this.sheetsService.logInteraction({
      contactId,
      nombre,
      mensaje: userText,
      intent: 'CONVERSACIONAL',
      respuesta,
    });

    console.log(`💬 CONVERSACIONAL: "${respuesta}"`);
    return { status: 'success' };
  }
}
