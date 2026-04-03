import { Injectable, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type CacheEntry = {
  turns: string[];
  lastAccess: number;
};

export type ResponseType =
  | 'PRECIO_ENVIADO'
  | 'BANCO_ENVIADO'
  | 'INFO_ENVIADA'
  | 'SILENCIO';

export interface ConversationState {
  lastResponseType: ResponseType;
  lastProducts: string[];
  lastBanco: string | null;
  lastCantidad: number | null;
  lastTipo: string | null;
  updatedAt: number;
}

// ─── Memoria de cliente — persiste indefinidamente ────────────────────────────

export interface ClientProfile {
  nombre?: string;
  bancos?: Record<string, number>; // { produbanco: 5, guayaquil: 1 }
  productos?: Record<
    string,
    {
      veces: number;
      cantidadFrecuente: number | null;
      tipoFrecuente: string | null;
      ultimaFecha: string;
    }
  >;
  totalCompras: number;
  updatedAt: string;
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable()
export class HistoryService implements OnModuleInit {
  private redis: Redis;

  private ramCache = new Map<string, CacheEntry>();
  private stateCache = new Map<string, ConversationState>();
  private profileCache = new Map<string, ClientProfile>(); // ← RAM para perfiles

  private readonly MAX_TURNS = 5;
  private readonly TTL_MS = 86400000;
  private readonly TTL_SECONDS = 86400;
  private readonly STATE_TTL_SECONDS = 3600;
  private readonly CLEANUP_INTERVAL = 3600000;

  async onModuleInit() {
    this.redis = new Redis(
      process.env.REDIS_URL ||
        ({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD || undefined,
        } as any),
    );

    this.redis.on('connect', () => console.log('✅ Redis conectado'));
    this.redis.on('error', (err) =>
      console.error('❌ Redis error:', err.message),
    );

    setInterval(() => this.cleanupRAM(), this.CLEANUP_INTERVAL);
  }

  // ─── Obtener historial ────────────────────────────────────────────────────

  async getHistory(contactId: string, limit = 3): Promise<string> {
    const cached = this.ramCache.get(contactId);
    if (cached) {
      if (Date.now() - cached.lastAccess > this.TTL_MS) {
        this.ramCache.delete(contactId);
        return '';
      }
      return cached.turns.slice(-limit).join('\n');
    }

    try {
      const raw = await this.redis.get(`hist:${contactId}`);
      if (raw) {
        const turns: string[] = JSON.parse(raw);
        this.ramCache.set(contactId, { turns, lastAccess: Date.now() });
        console.log(`🔄 Historial restaurado desde Redis: [${contactId}]`);
        return turns.slice(-limit).join('\n');
      }
    } catch (err) {
      console.error('❌ Redis getHistory:', err.message);
    }

    return '';
  }

  // ─── Guardar turno ────────────────────────────────────────────────────────

  save(contactId: string, mensaje: string, respuesta: string): void {
    const esRespuestaReal =
      respuesta !== 'SILENCIO' &&
      respuesta !== 'SIN_CONTEXTO_BD' &&
      respuesta !== 'SIN_PLANTILLA' &&
      !respuesta.startsWith('IA_');

    const turno = esRespuestaReal
      ? `U: ${mensaje.slice(0, 80)} → ${respuesta.slice(0, 100)}`
      : `U: ${mensaje.slice(0, 80)}`;

    const cached = this.ramCache.get(contactId) || {
      turns: [],
      lastAccess: 0,
    };

    cached.turns.push(turno);
    if (cached.turns.length > this.MAX_TURNS) cached.turns.shift();
    cached.lastAccess = Date.now();
    this.ramCache.set(contactId, cached);

    if (esRespuestaReal) {
      this.redis
        .set(
          `hist:${contactId}`,
          JSON.stringify(cached.turns),
          'EX',
          this.TTL_SECONDS,
        )
        .catch((err) => console.error('❌ Redis save:', err.message));
    }
  }

  // ─── ConversationState ────────────────────────────────────────────────────

  async getState(contactId: string): Promise<ConversationState | null> {
    const cached = this.stateCache.get(contactId);
    if (cached) {
      if (Date.now() - cached.updatedAt > this.STATE_TTL_SECONDS * 1000) {
        this.stateCache.delete(contactId);
        return null;
      }
      return cached;
    }

    try {
      const raw = await this.redis.get(`state:${contactId}`);
      if (raw) {
        const state: ConversationState = JSON.parse(raw);
        this.stateCache.set(contactId, state);
        return state;
      }
    } catch (err) {
      console.error('❌ Redis getState:', err.message);
    }

    return null;
  }

  setState(contactId: string, state: ConversationState): void {
    const full: ConversationState = { ...state, updatedAt: Date.now() };
    this.stateCache.set(contactId, full);
    this.redis
      .set(
        `state:${contactId}`,
        JSON.stringify(full),
        'EX',
        this.STATE_TTL_SECONDS,
      )
      .catch((err) => console.error('❌ Redis setState:', err.message));
  }

  clearState(contactId: string): void {
    this.stateCache.delete(contactId);
    this.redis
      .del(`state:${contactId}`)
      .catch((err) => console.error('❌ Redis clearState:', err.message));
  }

  // ─── ClientProfile — memoria persistente por cliente ─────────────────────
  //
  // Sin TTL — no expira nunca. Se actualiza cada vez que cierra una compra.
  // Permite personalizar respuestas y detectar patrones de compra.

  async getProfile(contactId: string): Promise<ClientProfile | null> {
    // 1. RAM primero
    const cached = this.profileCache.get(contactId);
    if (cached) return cached;

    // 2. Redis fallback
    try {
      const raw = await this.redis.get(`profile:${contactId}`);
      if (raw) {
        const profile: ClientProfile = JSON.parse(raw);
        this.profileCache.set(contactId, profile);
        return profile;
      }
    } catch (err) {
      console.error('❌ Redis getProfile:', err.message);
    }

    return null;
  }

  async updateProfile(
    contactId: string,
    nombre: string,
    productos: string[],
    banco: string | null,
    cantidad: number | null,
    tipo: string | null,
  ): Promise<void> {
    const current = (await this.getProfile(contactId)) || {
      totalCompras: 0,
      updatedAt: new Date().toISOString(),
    };

    // Actualizar nombre
    current.nombre = nombre;

    // Actualizar banco — incrementar contador
    if (banco) {
      current.bancos = current.bancos || {};
      current.bancos[banco] = (current.bancos[banco] ?? 0) + 1;
    }

    // Actualizar productos — frecuencia + última fecha
    current.productos = current.productos || {};
    for (const p of productos) {
      const prev = current.productos[p] || {
        veces: 0,
        cantidadFrecuente: null,
        tipoFrecuente: null,
        ultimaFecha: '',
      };

      current.productos[p] = {
        veces: prev.veces + 1,
        cantidadFrecuente: cantidad ?? prev.cantidadFrecuente,
        tipoFrecuente: tipo ?? prev.tipoFrecuente,
        ultimaFecha: new Date().toISOString(),
      };
    }

    current.totalCompras = (current.totalCompras ?? 0) + 1;
    current.updatedAt = new Date().toISOString();

    // Guardar en RAM y Redis (sin TTL — no expira)
    this.profileCache.set(contactId, current);
    this.redis
      .set(`profile:${contactId}`, JSON.stringify(current))
      .catch((err) => console.error('❌ Redis updateProfile:', err.message));

    console.log(
      `🧠 Perfil actualizado [${contactId}]: ${productos.join(',')} banco=${banco ?? 'none'} total=${current.totalCompras}`,
    );
  }

  // Construye el texto compacto para inyectar en classify() — ~20 tokens
  buildProfileTexto(profile: ClientProfile | null): string | null {
    if (!profile) return null;

    const partes: string[] = [];

    // Banco más usado
    if (profile.bancos && Object.keys(profile.bancos).length > 0) {
      const bancoTop = Object.entries(profile.bancos).sort(
        (a, b) => b[1] - a[1],
      )[0][0];
      partes.push(`banco_usual=${bancoTop}`);
    }

    // Producto más frecuente
    if (profile.productos && Object.keys(profile.productos).length > 0) {
      const [nombre, datos] = Object.entries(profile.productos).sort(
        (a, b) => b[1].veces - a[1].veces,
      )[0];

      const detalle = datos.cantidadFrecuente
        ? `${nombre} x${datos.cantidadFrecuente} ${datos.tipoFrecuente ?? ''} (${datos.veces}x)`
        : `${nombre} (${datos.veces}x)`;

      partes.push(`compra_frecuente=${detalle.trim()}`);
    }

    return partes.length ? `CLIENTE: ${partes.join(' | ')}` : null;
  }

  // ─── Limpiar todo ─────────────────────────────────────────────────────────

  clear(contactId: string): void {
    this.ramCache.delete(contactId);
    this.stateCache.delete(contactId);
    this.redis
      .del(`hist:${contactId}`, `state:${contactId}`)
      .catch((err) => console.error('❌ Redis clear:', err.message));
    // Nota: NO borramos el profile — la memoria de cliente es permanente
  }

  // ─── Cleanup RAM ──────────────────────────────────────────────────────────

  private cleanupRAM(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [contactId, entry] of this.ramCache.entries()) {
      if (now - entry.lastAccess > this.TTL_MS) {
        this.ramCache.delete(contactId);
        this.stateCache.delete(contactId);
        // profileCache NO se limpia — vive en RAM indefinidamente para clientes activos
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 RAM cleanup: ${cleaned} historiales eliminados`);
    }
  }

  // ─── Guardar mensaje del agente humano ───────────────────────────────────

  saveAgentMessage(contactId: string, mensaje: string): void {
    const cached = this.ramCache.get(contactId) || {
      turns: [],
      lastAccess: 0,
    };

    cached.turns.push(`AGENTE: ${mensaje.slice(0, 100)}`);
    if (cached.turns.length > this.MAX_TURNS) cached.turns.shift();
    cached.lastAccess = Date.now();
    this.ramCache.set(contactId, cached);

    this.clearState(contactId);

    this.redis
      .set(
        `hist:${contactId}`,
        JSON.stringify(cached.turns),
        'EX',
        this.TTL_SECONDS,
      )
      .catch((err) => console.error('❌ Redis saveAgentMessage:', err.message));
  }
}
