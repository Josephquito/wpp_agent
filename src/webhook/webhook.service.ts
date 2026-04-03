// src/webhook/webhook.service.ts
import { Injectable } from '@nestjs/common';
import { GoogleSheetsService } from '../config/google-sheets.service';
import { OpenaiService } from '../openai/openai.service';
import { ContactTrackerService } from '../contacts/contact-tracker.service';
import { MessageGuardService } from '../message-guard/message-guard.service';
import { HistoryService } from '../history/history.service';
import { AgentService } from '../agent/agent.service';
import { CompraHandler } from '../agent/handlers/compra.handler';
import { PagoHandler } from '../agent/handlers/pago.handler';
import { InfoHandler } from '../agent/handlers/info.handler';
import { StateHandler } from '../agent/handlers/state.handler';
import { ConversacionalHandler } from '../agent/handlers/conversacional.handler';
import { CampaignTrackerService } from '../campaigns/campaign-tracker.service';

@Injectable()
export class WebhookService {
  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly openaiService: OpenaiService,
    private readonly contactTracker: ContactTrackerService,
    private readonly messageGuard: MessageGuardService,
    private readonly historyService: HistoryService,
    private readonly agentService: AgentService,
    private readonly compraHandler: CompraHandler,
    private readonly pagoHandler: PagoHandler,
    private readonly infoHandler: InfoHandler,
    private readonly stateHandler: StateHandler,
    private readonly conversacionalHandler: ConversacionalHandler,
    private readonly campaignTracker: CampaignTrackerService,
  ) {}

  async handleAgentMessage(body: any): Promise<{ status: string }> {
    const agenteTexto: string = body?.content?.trim() || '';
    const contactId: string =
      body?.conversation?.meta?.sender?.phone_number ||
      body?.conversation?.meta?.sender?.id?.toString() ||
      '';

    if (!agenteTexto || !contactId) return { status: 'agent_message' };

    const botTrigger =
      this.sheetsService.getConfig('BOT_TRIGGER') || 'Estamos a las ordenes';
    const takeoverMs =
      parseInt(this.sheetsService.getConfig('TAKEOVER_MS')) || 3600000;

    if (agenteTexto.toLowerCase().includes(botTrigger.toLowerCase())) {
      this.messageGuard.releaseTakeover(contactId);
      console.log(`🤖 [${contactId}] bot reactivado — "${botTrigger}"`);
    } else {
      this.messageGuard.registerAgentMessage(contactId, takeoverMs);
    }

    this.historyService.saveAgentMessage(contactId, agenteTexto);
    this.sheetsService.logInteraction({
      contactId,
      nombre: 'AGENTE',
      mensaje: agenteTexto,
      intent: 'AGENTE',
      respuesta: agenteTexto,
    });

    console.log(`👤 Agente [${contactId}]: "${agenteTexto}"`);
    return { status: 'agent_message' };
  }

  async handleIncomingMessage(body: any): Promise<{ status: string }> {
    const rawText: string = body?.content?.trim() || '';
    const contactId: string =
      body?.sender?.phone_number || body?.sender?.id?.toString() || '';
    const nombre: string = body?.sender?.name || 'Cliente';
    const conversationId: number = body?.conversation?.id;
    const accountId: number = body?.account?.id;

    if (!rawText || !conversationId || !contactId) return { status: 'no_data' };

    // ── Registrar contacto siempre, agente encendido o no ─────────────────
    this.contactTracker.registerIfNew(contactId, nombre); // ← solo estos dos
    this.campaignTracker.notifyResponded(contactId);

    // ── Comprobante — takeover independiente del agente ───────────────────
    const tieneAdjunto =
      body?.attachments?.length > 0 ||
      body?.content_attributes?.attachments?.length > 0;

    if (tieneAdjunto) {
      const takeoverMs =
        parseInt(this.sheetsService.getConfig('TAKEOVER_MS')) || 3600000;
      this.messageGuard.registerAgentMessage(contactId, takeoverMs);
      this.historyService.save(contactId, '[comprobante]', 'SILENCIO');
      console.log(`🧾 Comprobante: [${contactId}] takeover activado.`);
      return { status: 'comprobante' };
    }

    // ── Check agente ──────────────────────────────────────────────────────
    const agentEnabled = await this.agentService.isEnabled();
    if (!agentEnabled) {
      console.log(`🔴 Agente apagado — [${contactId}] ignorado`);
      return { status: 'agent_disabled' };
    }

    // ── Guards ────────────────────────────────────────────────────────────
    if (this.messageGuard.isSpam(contactId)) {
      console.log(`🚨 SPAM: [${contactId}] ignorado.`);
      return { status: 'spam' };
    }

    const takeoverMs =
      parseInt(this.sheetsService.getConfig('TAKEOVER_MS')) || 3600000;
    if (this.messageGuard.isBotPaused(contactId, takeoverMs)) {
      console.log(`🤝 TAKEOVER activo: [${contactId}] bot en silencio.`);
      this.historyService.save(contactId, rawText, 'SILENCIO');
      return { status: 'takeover' };
    }

    const debounceMs =
      parseInt(this.sheetsService.getConfig('DEBOUNCE_MS')) || 3000;
    const spamLimit = parseInt(this.sheetsService.getConfig('SPAM_LIMIT')) || 5;
    this.messageGuard.setConfig(debounceMs, spamLimit);

    const userText = await this.messageGuard.debounce(contactId, rawText);
    console.log(`📩 [${contactId}] ${nombre}: "${userText}"`);

    const history = await this.historyService.getHistory(contactId, 5);
    const profile = await this.historyService.getProfile(contactId);
    const profileTexto = this.historyService.buildProfileTexto(profile);
    if (profileTexto) console.log(`🧠 [${contactId}] ${profileTexto}`);

    // ── Classify ──────────────────────────────────────────────────────────
    const { intent, productos, productosDetalle, banco, cantidad, tipo } =
      await this.openaiService.classify(userText, history);

    console.log(
      `🎯 Intent: ${intent} | productos: ${productos.join(', ')} | banco: ${banco} | cantidad: ${cantidad} | tipo: ${tipo}`,
    );

    // ── State handler ─────────────────────────────────────────────────────
    const state = await this.historyService.getState(contactId);
    const stateResult = await this.stateHandler.handle({
      state,
      intent,
      userText,
      contactId,
      nombre,
      accountId,
      conversationId,
    });
    if (stateResult) return stateResult;

    // ── Handlers por intent ───────────────────────────────────────────────
    if (intent === 'OFFTOPIC') {
      console.log('🙊 OFFTOPIC: silencio.');
      this.historyService.save(contactId, userText, 'SILENCIO');
      return { status: 'silence' };
    }

    if (intent === 'SOPORTE') {
      console.log('🙊 SOPORTE: silencio, humano responderá.');
      this.historyService.save(contactId, userText, 'SILENCIO');
      this.sheetsService.logInteraction({
        contactId,
        nombre,
        mensaje: userText,
        intent,
        respuesta: this.sheetsService.getConfig('SILENCIO_LOG') || 'SILENCIO',
      });
      return { status: 'silence_soporte' };
    }

    if (intent === 'PAGO') {
      return this.pagoHandler.handle({
        banco,
        productos,
        cantidad,
        tipo,
        contactId,
        nombre,
        userText,
        accountId,
        conversationId,
      });
    }

    if (intent === 'COMPRA') {
      return this.compraHandler.handle({
        productos,
        productosDetalle,
        cantidad,
        tipo,
        contactId,
        nombre,
        userText,
        accountId,
        conversationId,
        history,
      });
    }

    if (intent === 'INFO') {
      return this.infoHandler.handle({
        userText,
        productos,
        contactId,
        nombre,
        accountId,
        conversationId,
        history,
      });
    }

    if (intent === 'CONVERSACIONAL') {
      return this.conversacionalHandler.handle({
        contactId,
        nombre,
        userText,
        accountId,
        conversationId,
        history,
      });
    }

    return { status: 'ignored' };
  }
}
