import { Injectable } from '@nestjs/common';
import { GoogleSheetsService } from '../../config/google-sheets.service';
import { HistoryService } from '../../history/history.service';
import { OpenaiService } from '../../openai/openai.service';
import { ChatwootService } from '../../chatwoot/chatwoot.service';

@Injectable()
export class CompraHandler {
  constructor(
    private readonly sheetsService: GoogleSheetsService,
    private readonly historyService: HistoryService,
    private readonly openaiService: OpenaiService,
    private readonly chatwoot: ChatwootService,
  ) {}

  async handle(args: {
    productos: string[];
    productosDetalle: any[];
    cantidad: number | null;
    tipo: string | null;
    contactId: string;
    nombre: string;
    userText: string;
    accountId: number;
    conversationId: number;
    history: string;
  }): Promise<{ status: string }> {
    const {
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
    } = args;

    if (!productos.length) {
      console.log('🙊 COMPRA: ningún producto identificado, silencio.');
      this.historyService.save(contactId, userText, 'SILENCIO');
      this.sheetsService.logInteraction({
        contactId,
        nombre,
        mensaje: userText,
        intent: 'COMPRA',
        respuesta: 'SIN_CONTEXTO_BD',
      });
      return { status: 'silence' };
    }

    const header = this.sheetsService.getConfig('BOT_HEADER');
    const msgPrecios = this.sheetsService.getConfig('MENSAJE_PRECIOS');
    const msgNoDisponible = this.sheetsService.getConfig(
      'MENSAJE_NO_DISPONIBLE',
    );
    const tipoNorm = tipo || 'meses';
    const respuestasEnviadas: string[] = [];

    // ── Leer estado actual — para no repetir productos ya enviados ────────
    const state = await this.historyService.getState(contactId);
    const productosYaEnviados: string[] = state?.lastProducts ?? [];

    // ── Multi-detalle ──────────────────────────────────────────────────────
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
          intent: 'COMPRA',
          respuesta: 'SIN_CONTEXTO_BD',
        });
        return { status: 'silence' };
      }

      const resumen = [
        ...lineas,
        `─────────────`,
        `Total > $${total.toFixed(2)}`,
      ].join('\n');

      await this.chatwoot.send(
        accountId,
        conversationId,
        `${header}\n${msgPrecios}`,
      );
      await this.chatwoot.send(
        accountId,
        conversationId,
        `${header}\n${resumen}`,
      );

      this.historyService.setState(contactId, {
        lastResponseType: 'PRECIO_ENVIADO',
        lastProducts: [
          ...productosYaEnviados,
          ...productosDetalle.map((d) => d.nombre),
        ],
        lastBanco: null,
        lastCantidad: null,
        lastTipo: null,
        updatedAt: Date.now(),
      });
      this.historyService.save(contactId, userText, resumen);
      this.sheetsService.logInteraction({
        contactId,
        nombre,
        mensaje: userText,
        intent: 'COMPRA',
        respuesta: resumen,
      });
      console.log(`🧮 COMPRA multi-detalle: total $${total.toFixed(2)}`);
      return { status: 'success' };
    }

    // ── Flujo normal ───────────────────────────────────────────────────────
    let saludoEnviado = false;

    for (const productoNombre of productos) {
      const productoRow = this.sheetsService.findProducto(productoNombre);
      if (!productoRow) {
        console.log(
          `🙊 COMPRA: producto "${productoNombre}" no encontrado en BD, skip.`,
        );
        continue;
      }

      // ── Skip si ya se envió este producto antes ───────────────────────
      if (
        productosYaEnviados
          .map((p) => p.toLowerCase())
          .includes(productoRow.nombre.toLowerCase())
      ) {
        console.log(`⏭️ SKIP: "${productoRow.nombre}" ya enviado antes`);
        continue;
      }

      // Sin cantidad → enviar todos los planes
      if (!cantidad) {
        if (!saludoEnviado) {
          await this.chatwoot.send(
            accountId,
            conversationId,
            `${header}\n${msgPrecios}`,
          );
          saludoEnviado = true;
        }
        await this.chatwoot.send(
          accountId,
          conversationId,
          `${header}\n${productoRow.precio}`,
        );
        respuestasEnviadas.push(productoRow.precio);
        this.historyService.setState(contactId, {
          lastResponseType: 'PRECIO_ENVIADO',
          lastProducts: [...productosYaEnviados, productoRow.nombre],
          lastBanco: null,
          lastCantidad: null,
          lastTipo: tipoNorm,
          updatedAt: Date.now(),
        });
        console.log(
          `🛒 COMPRA bypass: "${productoRow.nombre}" todos los planes`,
        );
        continue;
      }

      // Pide días → no calcular, ofrecer planes disponibles
      const tipoNormalizado = tipoNorm.toLowerCase();
      if (['dias', 'día', 'dia', 'days'].includes(tipoNormalizado)) {
        await this.chatwoot.send(
          accountId,
          conversationId,
          `${header}\n${msgNoDisponible}`,
        );
        await this.chatwoot.send(
          accountId,
          conversationId,
          `${header}\n${productoRow.precio}`,
        );
        respuestasEnviadas.push(productoRow.precio);
        this.historyService.setState(contactId, {
          lastResponseType: 'PRECIO_ENVIADO',
          lastProducts: [...productosYaEnviados, productoRow.nombre],
          lastBanco: null,
          lastCantidad: null,
          lastTipo: tipoNorm,
          updatedAt: Date.now(),
        });
        console.log(
          `🙊 COMPRA días: "${productoRow.nombre}" → ofreciendo planes disponibles`,
        );
        continue;
      }

      // Cantidad exacta en BD
      const precioExactoExiste = this.sheetsService.findPrecioExacto(
        productoRow.precio,
        cantidad,
        tipoNorm,
      );

      if (precioExactoExiste) {
        if (!saludoEnviado) {
          await this.chatwoot.send(
            accountId,
            conversationId,
            `${header}\n${msgPrecios}`,
          );
          saludoEnviado = true;
        }
        await this.chatwoot.send(
          accountId,
          conversationId,
          `${header}\n${productoRow.precio}`,
        );
        respuestasEnviadas.push(productoRow.precio);
        this.historyService.setState(contactId, {
          lastResponseType: 'PRECIO_ENVIADO',
          lastProducts: [...productosYaEnviados, productoRow.nombre],
          lastBanco: null,
          lastCantidad: cantidad,
          lastTipo: tipoNorm,
          updatedAt: Date.now(),
        });
        console.log(
          `🛒 COMPRA exacta: "${productoRow.nombre}" [${cantidad} ${tipoNorm}]`,
        );
        continue;
      }

      // IA calcula — solo meses no exactos en BD
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
        `🧮 COMPRA cálculo IA: "${productoRow.nombre}" [${cantidad} ${tipoNorm}]`,
      );

      const result = await this.chatwoot.handleIAResponse({
        respuesta,
        accountId,
        conversationId,
        contactId,
        nombre,
        userText,
        intent: 'COMPRA',
      });

      if (result.status === 'success') {
        respuestasEnviadas.push(respuesta);
        this.historyService.setState(contactId, {
          lastResponseType: 'PRECIO_ENVIADO',
          lastProducts: [...productosYaEnviados, productoRow.nombre],
          lastBanco: null,
          lastCantidad: cantidad,
          lastTipo: tipoNorm,
          updatedAt: Date.now(),
        });
      }
    }

    if (respuestasEnviadas.length === 0) {
      this.historyService.save(contactId, userText, 'SILENCIO');
      this.sheetsService.logInteraction({
        contactId,
        nombre,
        mensaje: userText,
        intent: 'COMPRA',
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
      intent: 'COMPRA',
      respuesta: respuestasEnviadas.join(' | '),
    });

    return { status: 'success' };
  }
}
