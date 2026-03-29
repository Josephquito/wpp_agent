import {
  Controller,
  Post,
  Body,
  Get,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { OpenaiService } from '../openai/openai.service';
import { ContactTrackerService } from '../contact-tracker/contact-tracker.service';
import { MessageGuardService } from '../message/message-guard.service';
import { HistoryService } from '../history/history.service';
import axios from 'axios';

@Controller('webhook')
export class WebhookController {
  private readonly CHATWOOT_URL = process.env.CHATWOOT_URL;
  private readonly CHATWOOT_TOKEN = process.env.CHATWOOT_TOKEN;

  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly openaiService: OpenaiService,
    private readonly contactTracker: ContactTrackerService,
    private readonly messageGuard: MessageGuardService,
    private readonly historyService: HistoryService,
  ) {}

  // ─── Recibir mensaje de Chatwoot ──────────────────────────────────────────

  @Post()
  async receiveMessage(@Body() body: any): Promise<{ status: string }> {
    if (body?.event !== 'message_created') return { status: 'ignored' };

    // ── Capturar mensajes del agente ─────────────────────────────────────────
    if (body?.message_type === 'outgoing') {
      // ── Ignorar mensajes del bot (enviados por la integración) ─────────────
      const esBot =
        body?.sender?.name === 'Chatwoot' &&
        body?.content_attributes?.external_echo !== true;

      if (esBot) return { status: 'ignored' };

      const agenteTexto: string = body?.content?.trim() || '';
      const contactId: string =
        body?.conversation?.meta?.sender?.phone_number ||
        body?.conversation?.meta?.sender?.id?.toString() ||
        '';

      if (agenteTexto && contactId) {
        const botTrigger =
          this.sheetsService.getConfig('BOT_TRIGGER') ||
          'Estamos a las ordenes';
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
      }
      return { status: 'agent_message' };
    }

    if (body?.message_type !== 'incoming') return { status: 'ignored' };

    const rawText: string = body?.content?.trim() || '';
    const contactId: string =
      body?.sender?.phone_number || body?.sender?.id?.toString() || '';
    const nombre: string = body?.sender?.name || 'Cliente';
    const conversationId: number = body?.conversation?.id;
    const accountId: number = body?.account?.id;

    if (!rawText || !conversationId || !contactId) return { status: 'no_data' };

    //-- revisar si viene con archivo adjunto
    const tieneAdjunto =
      body?.attachments?.length > 0 ||
      body?.content_attributes?.attachments?.length > 0;

    if (tieneAdjunto) {
      const takeoverMs =
        parseInt(this.sheetsService.getConfig('TAKEOVER_MS')) || 3600000;
      this.messageGuard.registerAgentMessage(contactId, takeoverMs);
      this.historyService.save(contactId, '[comprobante]', 'SILENCIO');
      console.log(
        `🧾 Comprobante detectado: [${contactId}] takeover activado.`,
      );
      return { status: 'comprobante' };
    }

    // ── 1. Blacklist → ignorar sin log ni IA ─────────────────────────────────
    if (this.messageGuard.isBlacklisted(contactId)) {
      console.log(`🚫 BLACKLIST: [${contactId}] ignorado.`);
      return { status: 'blacklisted' };
    }

    // ── 2. Spam → ignorar ────────────────────────────────────────────────────
    if (this.messageGuard.isSpam(contactId)) {
      console.log(`🚨 SPAM: [${contactId}] ignorado.`);
      return { status: 'spam' };
    }

    // ── 3. Human Takeover → bot pausado si agente intervino ──────────────────
    const takeoverMs =
      parseInt(this.sheetsService.getConfig('TAKEOVER_MS')) || 3600000;

    if (this.messageGuard.isBotPaused(contactId, takeoverMs)) {
      console.log(`🤝 TAKEOVER activo: [${contactId}] bot en silencio.`);
      this.historyService.save(contactId, rawText, 'SILENCIO');
      return { status: 'takeover' };
    }

    // ── 4. Configurar guards desde DB_Config ─────────────────────────────────
    const debounceMs =
      parseInt(this.sheetsService.getConfig('DEBOUNCE_MS')) || 3000;
    const spamLimit = parseInt(this.sheetsService.getConfig('SPAM_LIMIT')) || 5;
    this.messageGuard.setConfig(debounceMs, spamLimit);

    // ── 5. Debounce → acumular mensajes y procesar como uno solo ─────────────
    const userText = await this.messageGuard.debounce(contactId, rawText);

    console.log(`📩 [${contactId}] ${nombre}: "${userText}"`);

    // ── 6. Registrar contacto nuevo ───────────────────────────────────────────
    this.contactTracker.registerIfNew(contactId, nombre);

    // ── 7. Historial completo desde HistoryService ────────────────────────────
    const history = await this.historyService.getHistory(contactId, 10);

    // ── 8. Clasificar intent ──────────────────────────────────────────────────
    const { intent, productos, productosDetalle, banco, cantidad, tipo } =
      await this.openaiService.classify(userText, history);

    console.log(
      `🎯 Intent: ${intent} | productos: ${productos.join(', ')} | banco: ${banco} | cantidad: ${cantidad} | tipo: ${tipo}`,
    );

    // ── OFFTOPIC → silencio total ─────────────────────────────────────────────
    if (intent === 'OFFTOPIC') {
      console.log('🙊 OFFTOPIC: silencio total.');
      this.historyService.save(contactId, userText, 'SILENCIO');
      return { status: 'silence' };
    }

    // ── SOPORTE → silencio, humano se encarga ─────────────────────────────────
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

    // ── PAGO → bypass IA, plantilla directa desde DB_Pagos ───────────────────
    if (intent === 'PAGO') {
      const plantilla = this.sheetsService.findPlantillaPago(banco);

      if (!plantilla) {
        console.log('🙊 PAGO: sin plantilla en BD, silencio.');
        this.historyService.save(contactId, userText, 'SILENCIO');
        this.sheetsService.logInteraction({
          contactId,
          nombre,
          mensaje: userText,
          intent,
          respuesta: 'SIN_PLANTILLA',
        });
        return { status: 'silence' };
      }

      const header = this.sheetsService.getConfig('BOT_HEADER');
      const msgComprobante = this.sheetsService.getConfig(
        'MENSAJE_COMPROBANTE',
      );

      await this.sendToChatwoot(
        accountId,
        conversationId,
        `${header}\n${plantilla}`,
      );
      await this.sendToChatwoot(
        accountId,
        conversationId,
        `${header}\n${msgComprobante}`,
      );

      this.historyService.save(contactId, userText, plantilla);
      this.sheetsService.logInteraction({
        contactId,
        nombre,
        mensaje: userText,
        intent,
        respuesta: plantilla,
      });

      console.log(`💰 PAGO: plantilla enviada (banco: ${banco || 'default'})`);
      return { status: 'success' };
    }

    // ── COMPRA ────────────────────────────────────────────────────────────────
    if (intent === 'COMPRA') {
      if (!productos.length) {
        console.log('🙊 COMPRA: ningún producto identificado, silencio.');
        this.historyService.save(contactId, userText, 'SILENCIO');
        this.sheetsService.logInteraction({
          contactId,
          nombre,
          mensaje: userText,
          intent,
          respuesta: 'SIN_CONTEXTO_BD',
        });
        return { status: 'silence' };
      }

      const header = this.sheetsService.getConfig('BOT_HEADER');
      const tipoNorm = tipo || 'meses';
      const respuestasEnviadas: string[] = [];

      // ── Caso especial: cantidades distintas por producto → calcular total ───
      if (productosDetalle.length > 0) {
        const lineas: string[] = [];
        let total = 0;

        for (const detalle of productosDetalle) {
          const productoRow = this.sheetsService.findProducto(detalle.nombre);

          if (!productoRow) {
            console.log(
              `🙊 COMPRA detalle: "${detalle.nombre}" no encontrado, skip.`,
            );
            continue;
          }

          const precioExacto = this.sheetsService.findPrecioValor(
            productoRow.precio,
            detalle.cantidad,
            detalle.tipo,
          );

          if (precioExacto !== null) {
            total += precioExacto;
            lineas.push(
              `${productoRow.nombre} x${detalle.cantidad} ${detalle.tipo} > $${precioExacto.toFixed(2)}`,
            );
            console.log(
              `🛒 COMPRA detalle exacta: "${productoRow.nombre}" [${detalle.cantidad} ${detalle.tipo}] = $${precioExacto.toFixed(2)}`,
            );
            continue;
          }

          const precioUnitario = this.sheetsService.findPrecioUnitario(
            productoRow.precio,
          );

          if (!precioUnitario) {
            console.log(
              `🙊 COMPRA detalle: sin precio unitario para "${detalle.nombre}", skip.`,
            );
            continue;
          }

          const subtotal = precioUnitario * detalle.cantidad;
          total += subtotal;
          lineas.push(
            `${productoRow.nombre} x${detalle.cantidad} ${detalle.tipo} > $${subtotal.toFixed(2)}`,
          );
          console.log(
            `🧮 COMPRA detalle calculada: "${productoRow.nombre}" [${detalle.cantidad} ${detalle.tipo}] = $${subtotal.toFixed(2)}`,
          );
        }

        if (lineas.length === 0) {
          this.historyService.save(contactId, userText, 'SILENCIO');
          this.sheetsService.logInteraction({
            contactId,
            nombre,
            mensaje: userText,
            intent,
            respuesta: 'SIN_CONTEXTO_BD',
          });
          return { status: 'silence' };
        }

        const resumen = [
          ...lineas,
          `─────────────`,
          `Total > $${total.toFixed(2)}`,
        ].join('\n');

        await this.sendToChatwoot(
          accountId,
          conversationId,
          `${header}\n${resumen}`,
        );
        this.historyService.save(contactId, userText, resumen);
        this.sheetsService.logInteraction({
          contactId,
          nombre,
          mensaje: userText,
          intent,
          respuesta: resumen,
        });
        console.log(`🧮 COMPRA multi-detalle: total $${total.toFixed(2)}`);
        return { status: 'success' };
      }

      // ── Flujo normal: un precio por producto ──────────────────────────────
      for (const productoNombre of productos) {
        const productoRow = this.sheetsService.findProducto(productoNombre);

        if (!productoRow) {
          console.log(
            `🙊 COMPRA: producto "${productoNombre}" no encontrado en BD, skip.`,
          );
          continue;
        }

        if (!cantidad) {
          await this.sendToChatwoot(
            accountId,
            conversationId,
            `${header}\n${productoRow.precio}`,
          );
          respuestasEnviadas.push(productoRow.precio);
          console.log(
            `🛒 COMPRA bypass: "${productoRow.nombre}" todos los planes`,
          );
          continue;
        }

        const precioExactoExiste = this.sheetsService.findPrecioExacto(
          productoRow.precio,
          cantidad,
          tipoNorm,
        );

        if (precioExactoExiste) {
          await this.sendToChatwoot(
            accountId,
            conversationId,
            `${header}\n${productoRow.precio}`,
          );
          respuestasEnviadas.push(productoRow.precio);
          console.log(
            `🛒 COMPRA exacta: "${productoRow.nombre}" [${cantidad} ${tipoNorm}]`,
          );
          continue;
        }

        const contexto = [
          `Producto: ${productoRow.nombre}`,
          `Precios base disponibles en BD:\n${productoRow.precio}`,
          `Reglas de venta: ${productoRow.reglasVenta || 'ninguna'}`,
        ].join('\n');

        const respuesta = await this.openaiService.generateResponse({
          intent: 'COMPRA',
          userMessage: userText,
          context: contexto,
          history,
        });

        console.log(
          `🧮 COMPRA cálculo: "${productoRow.nombre}" [${cantidad} ${tipoNorm}]`,
        );

        const result = await this.handleIAResponse({
          respuesta,
          accountId,
          conversationId,
          contactId,
          nombre,
          userText,
          intent,
        });

        if (result.status === 'success') respuestasEnviadas.push(respuesta);
      }

      if (respuestasEnviadas.length === 0) {
        this.historyService.save(contactId, userText, 'SILENCIO');
        this.sheetsService.logInteraction({
          contactId,
          nombre,
          mensaje: userText,
          intent,
          respuesta: 'SIN_CONTEXTO_BD',
        });
        return { status: 'silence' };
      }

      this.historyService.save(
        contactId,
        userText,
        respuestasEnviadas.join(' | '),
      );
      this.sheetsService.logInteraction({
        contactId,
        nombre,
        mensaje: userText,
        intent,
        respuesta: respuestasEnviadas.join(' | '),
      });

      return { status: 'success' };
    }

    // ── INFO → buscar en DB_Info + Reglas_Producto + IA ──────────────────────
    if (intent === 'INFO') {
      const contexto = this.sheetsService.findInfo(userText, productos);

      if (!contexto) {
        console.log('🙊 INFO: sin contexto en BD, silencio.');
        this.historyService.save(contactId, userText, 'SILENCIO');
        this.sheetsService.logInteraction({
          contactId,
          nombre,
          mensaje: userText,
          intent,
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

      return await this.handleIAResponse({
        respuesta,
        accountId,
        conversationId,
        contactId,
        nombre,
        userText,
        intent,
      });
    }

    return { status: 'ignored' };
  }

  // ─── Manejar respuesta de la IA ───────────────────────────────────────────

  private async handleIAResponse(args: {
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
    await this.sendToChatwoot(
      accountId,
      conversationId,
      `${header}\n${respuesta}`,
    );

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

  // ─── Enviar mensaje a Chatwoot ────────────────────────────────────────────

  private async sendToChatwoot(
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

  // ─── Refresh manual de caché + blacklist ──────────────────────────────────

  @Get('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshCache(): Promise<{ message: string }> {
    await this.sheetsService.refreshCache();
    await this.messageGuard.reloadBlacklist();
    return { message: '✅ Caché y blacklist actualizadas.' };
  }
}
