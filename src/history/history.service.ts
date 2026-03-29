import { Injectable, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type CacheEntry = {
  turns: string[];
  lastAccess: number;
};

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable()
export class HistoryService implements OnModuleInit {
  private redis: Redis;

  private ramCache = new Map<string, CacheEntry>();

  private readonly MAX_TURNS = 10;
  private readonly TTL_MS = 86400000; // 24h en ms → para RAM
  private readonly TTL_SECONDS = 86400; // 24h en segundos → para Redis
  private readonly CLEANUP_INTERVAL = 3600000; // el conserje pasa cada 1h

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
  //
  // Flujo:
  // 1. Busca en RAM → si existe y no expiró → retorna inmediato (costo cero)
  // 2. Si expiró en RAM → elimina y retorna vacío (cliente arranca desde cero)
  // 3. Si no está en RAM (reinicio del servidor) → busca en Redis → repobla RAM
  // 4. Si tampoco está en Redis → retorna vacío (primera vez del cliente)

  async getHistory(contactId: string, limit = 3): Promise<string> {
    // 1 y 2. RAM
    const cached = this.ramCache.get(contactId);
    if (cached) {
      if (Date.now() - cached.lastAccess > this.TTL_MS) {
        this.ramCache.delete(contactId);
        return '';
      }
      return cached.turns.slice(-limit).join('\n');
    }

    // 3. Redis fallback — solo ocurre tras reinicio del servidor
    try {
      const raw = await this.redis.get(`hist:${contactId}`);
      if (raw) {
        const turns: string[] = JSON.parse(raw);
        this.ramCache.set(contactId, {
          turns,
          lastAccess: Date.now(),
        });
        console.log(`🔄 Historial restaurado desde Redis: [${contactId}]`);
        return turns.slice(-limit).join('\n');
      }
    } catch (err) {
      console.error('❌ Redis getHistory:', err.message);
    }

    // 4. Primera vez o expirado
    return '';
  }

  // ─── Guardar turno ────────────────────────────────────────────────────────
  //
  // Solo guarda cuando el bot respondió algo real al cliente.
  // Cada save() renueva el TTL de 24h tanto en RAM como en Redis.

  save(contactId: string, mensaje: string, respuesta: string): void {
    const esRespuestaReal =
      respuesta !== 'SILENCIO' &&
      respuesta !== 'SIN_CONTEXTO_BD' &&
      respuesta !== 'SIN_PLANTILLA' &&
      !respuesta.startsWith('IA_');

    // Formato según si el bot respondió o no
    const turno = esRespuestaReal
      ? `U: ${mensaje} | IA: ${respuesta}`
      : `U: ${mensaje}`; // ← solo el mensaje del cliente, sin respuesta IA

    const cached = this.ramCache.get(contactId) || {
      turns: [],
      lastAccess: 0,
    };

    cached.turns.push(turno);
    if (cached.turns.length > this.MAX_TURNS) cached.turns.shift();
    cached.lastAccess = Date.now();
    this.ramCache.set(contactId, cached);

    // Solo persistir en Redis si fue respuesta real
    // Los mensajes sin respuesta no necesitan sobrevivir un reinicio
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

  // ─── Limpiar historial manualmente ───────────────────────────────────────
  //
  // Útil si en el futuro quieres agregar un endpoint /webhook/clear/:contactId

  clear(contactId: string): void {
    this.ramCache.delete(contactId);
    this.redis
      .del(`hist:${contactId}`)
      .catch((err) => console.error('❌ Redis clear:', err.message));
  }

  // ─── Cleanup RAM ──────────────────────────────────────────────────────────
  //
  // Corre cada 1h. Solo elimina entradas donde el cliente
  // lleva más de 24h sin escribir. Clientes activos no se tocan.

  private cleanupRAM(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [contactId, entry] of this.ramCache.entries()) {
      if (now - entry.lastAccess > this.TTL_MS) {
        this.ramCache.delete(contactId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 RAM cleanup: ${cleaned} historiales eliminados`);
    }
  }

  // ── Guardar mensaje del agente humano ─────────────────────────────────────
  saveAgentMessage(contactId: string, mensaje: string): void {
    const cached = this.ramCache.get(contactId) || {
      turns: [],
      lastAccess: 0,
    };

    cached.turns.push(`AGENTE: ${mensaje}`);
    if (cached.turns.length > this.MAX_TURNS) cached.turns.shift();
    cached.lastAccess = Date.now();
    this.ramCache.set(contactId, cached);

    // Persistir en Redis
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
