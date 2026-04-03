import { Injectable } from '@nestjs/common';
import { GoogleSheetsService } from '../../config/google-sheets.service';
import { HistoryService } from '../../history/history.service';
import { ChatwootService } from '../../chatwoot/chatwoot.service';

@Injectable()
export class PagoHandler {
  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly historyService: HistoryService,
    private readonly chatwoot: ChatwootService,
  ) {}

  async handle(args: {
    banco: string | null;
    productos: string[];
    cantidad: number | null;
    tipo: string | null;
    contactId: string;
    nombre: string;
    userText: string;
    accountId: number;
    conversationId: number;
  }): Promise<{ status: string }> {
    const {
      banco,
      productos,
      cantidad,
      tipo,
      contactId,
      nombre,
      userText,
      accountId,
      conversationId,
    } = args;

    const plantilla = this.sheetsService.findPlantillaPago(banco);

    if (!plantilla) {
      console.log('🙊 PAGO: sin plantilla en BD, silencio.');
      this.historyService.save(contactId, userText, 'SILENCIO');
      this.sheetsService.logInteraction({
        contactId,
        nombre,
        mensaje: userText,
        intent: 'PAGO',
        respuesta: 'SIN_PLANTILLA',
      });
      return { status: 'silence' };
    }

    const header = this.sheetsService.getConfig('BOT_HEADER');
    const msgComprobante = this.sheetsService.getConfig('MENSAJE_COMPROBANTE');

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
      lastProducts: productos,
      lastBanco: banco,
      lastCantidad: null,
      lastTipo: null,
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
      productos,
      banco,
      cantidad,
      tipo,
    );

    console.log(`💰 PAGO: plantilla enviada (banco: ${banco || 'default'})`);
    return { status: 'success' };
  }
}
