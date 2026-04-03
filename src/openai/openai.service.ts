import { Injectable } from '@nestjs/common';
import { OpenAI } from 'openai';
import {
  GoogleSheetsService,
  ClassifyResult,
  Intent,
  ProductoDetalle,
} from '../config/google-sheets.service';

// ─── Tools para function calling ─────────────────────────────────────────────

const CLASSIFY_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'compra',
      description:
        'Cliente pregunta precio, disponibilidad, o quiere comprar/renovar un producto digital (Netflix, Disney, Spotify, Canva, ChatGPT, Max, etc). Incluye typos y nombres aproximados.',
      parameters: {
        type: 'object',
        properties: {
          productos: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lista de productos mencionados en minúsculas',
          },
          productos_detalle: {
            type: 'array',
            description:
              'Solo si cada producto tiene cantidad específica distinta',
            items: {
              type: 'object',
              properties: {
                nombre: { type: 'string' },
                cantidad: { type: 'number' },
                tipo: {
                  type: 'string',
                  enum: ['meses', 'perfiles', 'pantallas', 'dispositivos'],
                },
              },
              required: ['nombre', 'cantidad', 'tipo'],
            },
          },
          cantidad: {
            type: 'number',
            description: 'Cantidad si aplica a todos los productos',
          },
          tipo: {
            type: 'string',
            enum: ['meses', 'perfiles', 'pantallas', 'dispositivos'],
            description: 'Tipo si aplica a todos los productos',
          },
        },
        required: ['productos'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pago',
      description:
        'Cliente pide datos bancarios, métodos de pago, o confirma que va a pagar tras haber visto el precio. Ejemplos: "pasame la cuenta", "tienes produbanco", "dale te transfiero", "listo ya pago".',
      parameters: {
        type: 'object',
        properties: {
          banco: {
            type: 'string',
            description:
              'Nombre del banco o billetera si lo menciona, sino null',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'info',
      description:
        'Cliente pregunta sobre garantía, horarios, políticas, características del producto (dispositivos, perfiles, si es compartida, etc).',
      parameters: {
        type: 'object',
        properties: {
          productos: {
            type: 'array',
            items: { type: 'string' },
            description: 'Productos relacionados a la pregunta si los hay',
          },
        },
        required: ['productos'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'soporte',
      description:
        'Cliente tiene un problema técnico, error, falla, quiere otra cuenta, o pide credenciales de acceso de un producto que ya compró.',
      parameters: {
        type: 'object',
        properties: {
          productos: {
            type: 'array',
            items: { type: 'string' },
            description: 'Productos con problema si los menciona',
          },
        },
        required: ['productos'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'offtopic',
      description:
        'SOLO para: credenciales (Correo/Clave/Perfil), mensajes completamente irrelevantes al negocio (política, deportes, chistes), spam, o mensajes vacíos. NO usar para saludos, despedidas ni mensajes casuales relacionados al contexto de compra.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'conversacional',
      description:
        'Saludos ("hola", "buenos días", "amigo"), despedidas, agradecimientos, quejas de precio, avisos de pago posterior, mensajes casuales relacionados al negocio. El cliente espera una respuesta amable.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

// ─── System prompt — ahora mucho más corto ────────────────────────────────────

const SYSTEM_PROMPT = `Eres el clasificador de una tienda de cuentas digitales en Ecuador.
Analiza el mensaje y llama la función correcta.

CONTEXTO del historial:
- Si historial tiene precios recientes y el mensaje confirma o pide proceder → pago
- Si historial tiene datos bancarios y el mensaje es informal → conversacional
- Si historial tiene un producto y el mensaje es ambiguo → inferir ese producto

REGLAS clave:
- "me ayuda con una cuenta" → compra, el cliente quiere comprar
- "quiero una cuenta" → compra
- "necesito una cuenta" → compra  
- "me ayuda con la cuenta" + historial con precio → pago
- "cuenta" + nombre de producto digital → compra si no hay problema técnico
- "no funciona", "error", "falla", "no abre", "problema" → soporte
- SOPORTE solo cuando hay problema técnico explícito

NUNCA respondas en texto. Siempre llama una función.`;

@Injectable()
export class OpenaiService {
  private openai: OpenAI;

  constructor(private readonly sheetsService: GoogleSheetsService) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  // ─── PASO 1: Clasificar intent con function calling ───────────────────────

  async classify(
    userMessage: string,
    history: string,
  ): Promise<ClassifyResult> {
    const userContent = [
      history ? `HISTORIAL:\n${history}` : null,
      `MENSAJE: "${userMessage}"`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        max_tokens: 200,
        temperature: 0,
        tools: CLASSIFY_TOOLS,
        tool_choice: 'required', // siempre llama una función
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      });

      // ── Log de tokens ────────────────────────────────────────────────────
      const usage = completion.usage as any;
      console.log(
        `📊 [classify] in:${usage?.prompt_tokens} out:${usage?.completion_tokens} cached:${usage?.prompt_tokens_details?.cached_tokens ?? 0}`,
      );

      // ── Parsear tool call ─────────────────────────────────────────────────
      const toolCall = completion.choices[0]?.message?.tool_calls?.[0] as any;

      if (!toolCall) {
        console.warn('⚠️ classify: sin tool call → fallback OFFTOPIC');
        return this.fallbackResult();
      }

      const fnName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments || '{}');

      console.log(
        `🔍 Function call: ${fnName}(${toolCall.function.arguments})`,
      );

      return this.parseToolCall(fnName, args);
    } catch (error) {
      console.error('❌ Error classify:', error.message);
      return this.fallbackResult();
    }
  }

  // ─── PASO 2: Generar respuesta — sin cambios ──────────────────────────────

  async generateResponse(args: {
    intent: 'COMPRA' | 'INFO' | 'CONVERSACIONAL';
    userMessage: string;
    context: string;
    history: string;
  }): Promise<string> {
    const { intent, userMessage, context, history } = args;

    const offlineTrigger =
      this.sheetsService.getConfig('OFFLINE_TRIGGER') || 'OFFLINE_HUMAN_NEEDED';

    // ── System prompt según intent ────────────────────────────────────────
    let systemContent: string;

    if (intent === 'CONVERSACIONAL') {
      systemContent = `Eres el asistente de una tienda de cuentas digitales en Ecuador.
Responde amable y natural en máx 1 línea, sin emojis, lenguaje relajado ecuatoriano.
No inventes precios ni hagas promesas.
Si saluda → responder el saludo e invitar a preguntar. Ejemplo: "buenas, dime en qué te ayudo"
Si dice que pagará después → tranquilizarlo sin presionar.
Si se queja del precio → validar sin prometer descuentos.
Si agradece → responder con calidez.
Si se despide → despedirse amablemente.`;
    } else {
      const configKey =
        intent === 'COMPRA' ? 'PROMPT_COMPRA_CALCULO' : 'PROMPT_INFO';
      const promptBase = this.sheetsService.getConfig(configKey);
      systemContent = `${promptBase}\nSi no puedes calcularlo o excede los límites responde únicamente: ${offlineTrigger}`;
    }

    // ── User content — CONVERSACIONAL no necesita contexto de BD ─────────
    const userContent =
      intent === 'CONVERSACIONAL'
        ? [history ? `HISTORIAL:\n${history}` : null, `MENSAJE: ${userMessage}`]
            .filter(Boolean)
            .join('\n')
        : [
            `BASE DE DATOS:\n${context}`,
            history ? `HISTORIAL:\n${history}` : null,
            `PREGUNTA: ${userMessage}`,
          ]
            .filter(Boolean)
            .join('\n\n');

    // ── Tokens y temperatura según intent ────────────────────────────────
    const maxTokens =
      intent === 'CONVERSACIONAL' ? 60 : intent === 'INFO' ? 80 : 200;

    const temperature = intent === 'CONVERSACIONAL' ? 0.7 : 0.3;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        max_completion_tokens: maxTokens,
        temperature,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
      });

      const usage = completion.usage as any;
      console.log(
        `📊 [${intent}] in:${usage?.prompt_tokens} out:${usage?.completion_tokens} cached:${usage?.prompt_tokens_details?.cached_tokens ?? 0}`,
      );

      return completion.choices[0]?.message?.content?.trim() || offlineTrigger;
    } catch (error) {
      console.error('❌ Error generateResponse:', error.message);
      return offlineTrigger;
    }
  }

  // ─── Parsear tool call → ClassifyResult ──────────────────────────────────

  private parseToolCall(fnName: string, args: any): ClassifyResult {
    const intentMap: Record<string, Intent> = {
      compra: 'COMPRA',
      pago: 'PAGO',
      info: 'INFO',
      soporte: 'SOPORTE',
      offtopic: 'OFFTOPIC',
      conversacional: 'CONVERSACIONAL',
    };

    const intent: Intent = intentMap[fnName] ?? 'OFFTOPIC';

    const productosDetalle: ProductoDetalle[] = Array.isArray(
      args.productos_detalle,
    )
      ? args.productos_detalle
          .map((d: any) => ({
            nombre: d.nombre?.toLowerCase().trim() || '',
            cantidad: typeof d.cantidad === 'number' ? d.cantidad : 1,
            tipo: d.tipo?.toLowerCase().trim() || 'meses',
          }))
          .filter((d: ProductoDetalle) => d.nombre)
      : [];

    let productos: string[] = Array.isArray(args.productos)
      ? args.productos
          .map((p: string) => p.toLowerCase().trim())
          .filter(Boolean)
      : [];

    // ── Si hay productos_detalle pero no productos → extraer nombres ──────
    if (productos.length === 0 && productosDetalle.length > 0) {
      productos = productosDetalle.map((d) => d.nombre);
    }

    return {
      intent,
      productos,
      productosDetalle,
      banco: args.banco?.toLowerCase?.() || null,
      cantidad: typeof args.cantidad === 'number' ? args.cantidad : null,
      tipo: args.tipo?.toLowerCase?.() || null,
    };
  }

  // ─── Fallback ─────────────────────────────────────────────────────────────

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
