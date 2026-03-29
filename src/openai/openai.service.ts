import { Injectable } from '@nestjs/common';
import { OpenAI } from 'openai';
import {
  GoogleSheetsService,
  ClassifyResult,
  Intent,
  ProductoDetalle,
} from '../google-sheets/google-sheets.service';

@Injectable()
export class OpenaiService {
  private openai: OpenAI;

  constructor(private readonly sheetsService: GoogleSheetsService) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  // ─── PASO 1: Clasificar intent ─────────────────────────────────────────────

  async classify(
    userMessage: string,
    history: string,
  ): Promise<ClassifyResult> {
    const promptClasificador = this.sheetsService.getConfig(
      'PROMPT_CLASIFICADOR',
    );
    const ejemplos = this.sheetsService.getConfig('EJEMPLOS_CLASIFICADOR');

    const systemContent = `${promptClasificador}\n\nEJEMPLOS:\n${ejemplos}`;

    const userContent = [
      history ? `HISTORIAL:\n${history}` : null,
      `MENSAJE: "${userMessage}"`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        max_tokens: 200, // suficiente para JSON con hasta 5 productos + detalle
        temperature: 0, // clasificador debe ser determinístico, sin creatividad
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
      });

      const raw = completion.choices[0]?.message?.content?.trim() || '';
      console.log(`🔍 Clasificador raw: ${raw}`);
      return this.parseClassifyResult(raw);
    } catch (error) {
      console.error('❌ Error classify:', error.message);
      return this.fallbackResult();
    }
  }

  // ─── PASO 2: Generar respuesta — COMPRA con cálculo e INFO ────────────────

  async generateResponse(args: {
    intent: 'COMPRA' | 'INFO';
    userMessage: string;
    context: string;
    history: string;
  }): Promise<string> {
    const { intent, userMessage, context, history } = args;

    const configKey =
      intent === 'COMPRA' ? 'PROMPT_COMPRA_CALCULO' : 'PROMPT_INFO';
    const promptBase = this.sheetsService.getConfig(configKey);
    const offlineTrigger =
      this.sheetsService.getConfig('OFFLINE_TRIGGER') || 'OFFLINE_HUMAN_NEEDED';

    const systemContent = `${promptBase}\nSi no puedes calcularlo o excede los límites responde únicamente: ${offlineTrigger}`;

    const userContent = [
      `BASE DE DATOS:\n${context}`,
      history ? `HISTORIAL:\n${history}` : null,
      `PREGUNTA: ${userMessage}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        max_tokens: 200,
        temperature: 0.3, // algo de flexibilidad para redactar bien
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
      });

      return completion.choices[0]?.message?.content?.trim() || offlineTrigger;
    } catch (error) {
      console.error('❌ Error generateResponse:', error.message);
      return offlineTrigger;
    }
  }

  // ─── Parser ────────────────────────────────────────────────────────────────

  private parseClassifyResult(raw: string): ClassifyResult {
    const validIntents: Intent[] = [
      'COMPRA',
      'PAGO',
      'SOPORTE',
      'INFO',
      'OFFTOPIC',
    ];

    try {
      const clean = raw.replace(/```json|```/gi, '').trim();
      const parsed = JSON.parse(clean);

      const intent = validIntents.includes(parsed.intent?.toUpperCase())
        ? (parsed.intent.toUpperCase() as Intent)
        : 'OFFTOPIC';

      let productos: string[] = [];
      if (Array.isArray(parsed.productos)) {
        productos = parsed.productos
          .map((p: string) => p.toLowerCase().trim())
          .filter(Boolean);
      } else if (parsed.producto) {
        productos = [parsed.producto.toLowerCase().trim()];
      }

      const productosDetalle: ProductoDetalle[] = Array.isArray(
        parsed.productos_detalle,
      )
        ? parsed.productos_detalle
            .map((d: any) => ({
              nombre: d.nombre?.toLowerCase().trim() || '',
              cantidad: typeof d.cantidad === 'number' ? d.cantidad : 1,
              tipo: d.tipo?.toLowerCase().trim() || 'meses',
            }))
            .filter((d: ProductoDetalle) => d.nombre)
        : [];

      return {
        intent,
        productos,
        productosDetalle,
        banco: parsed.banco?.toLowerCase?.() || null,
        cantidad: typeof parsed.cantidad === 'number' ? parsed.cantidad : null,
        tipo: parsed.tipo?.toLowerCase?.() || null,
      };
    } catch {
      const upper = raw.toUpperCase().trim();
      const intent = validIntents.find((i) => upper.includes(i)) || 'OFFTOPIC';
      return {
        intent,
        productos: [],
        productosDetalle: [],
        banco: null,
        cantidad: null,
        tipo: null,
      };
    }
  }

  // ─── Fallback ──────────────────────────────────────────────────────────────

  private fallbackResult(): ClassifyResult {
    return {
      intent: 'OFFTOPIC',
      productos: [],
      productosDetalle: [],
      banco: null,
      cantidad: null,
      tipo: null,
    };
  }
}
