import { Injectable } from '@nestjs/common';
import { GoogleSheetsService } from '../../config/google-sheets.service';
import { HistoryService } from '../../history/history.service';
import { ChatwootService } from '../../chatwoot/chatwoot.service';

@Injectable()
export class StateHandler {
  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly historyService: HistoryService,
    private readonly chatwoot: ChatwootService,
  ) {}

  async handle(args: {
    state: any;
    intent: string; // ← recibe el intent del classify
    userText: string;
    contactId: string;
    nombre: string;
    accountId: number;
    conversationId: number;
  }): Promise<{ status: string } | null> {
    const {
      state,
      intent,
      userText,
      contactId,
      nombre,
      accountId,
      conversationId,
    } = args;

    if (!state) return null;

    // PAGO directo sin IA — classify ya confirmó que es PAGO
    if (state.lastResponseType === 'PRECIO_ENVIADO' && intent === 'PAGO') {
      console.log(`⚡ [${contactId}] PAGO directo sin IA`);
      const plantilla = this.sheetsService.findPlantillaPago(state.lastBanco);

      if (plantilla) {
        const header = this.sheetsService.getConfig('BOT_HEADER');
        const msgComprobante = this.sheetsService.getConfig(
          'MENSAJE_COMPROBANTE',
        );

        await this.chatwoot.send(
          accountId,
          conversationId,
          `${header}\n${plantilla}`,
        );
        await this.chatwoot.send(
          accountId,
          conversationId,
          `${header}\n${msgComprobante}`,
        );

        this.historyService.save(contactId, userText, plantilla);
        this.historyService.setState(contactId, {
          lastResponseType: 'BANCO_ENVIADO',
          lastProducts: state.lastProducts,
          lastBanco: state.lastBanco,
          lastCantidad: state.lastCantidad,
          lastTipo: state.lastTipo,
          updatedAt: Date.now(),
        });
        this.sheetsService.logInteraction({
          contactId,
          nombre,
          mensaje: userText,
          intent: 'PAGO',
          respuesta: plantilla,
        });
        void this.historyService.updateProfile(
          contactId,
          nombre,
          state.lastProducts,
          state.lastBanco,
          state.lastCantidad,
          state.lastTipo,
        );
        console.log(
          `💰 PAGO directo sin IA (banco: ${state.lastBanco ?? 'default'})`,
        );
        return { status: 'success' };
      }
    }

    return null;
  }
}
