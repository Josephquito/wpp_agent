// src/agent/agent.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class AgentService implements OnModuleInit {
  private redis: Redis;

  async onModuleInit() {
    this.redis = new Redis(
      process.env.REDIS_URL ||
        ({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD || undefined,
        } as any),
    );

    const current = await this.redis.get('agent:enabled');
    if (current === null) {
      await this.redis.set('agent:enabled', '1');
    }

    const status = await this.isEnabled();
    console.log(`🤖 Agente IA: ${status ? '✅ ENCENDIDO' : '🔴 APAGADO'}`);
  }

  async isEnabled(): Promise<boolean> {
    const val = await this.redis.get('agent:enabled');
    return val === '1';
  }

  async enable(): Promise<void> {
    await this.redis.set('agent:enabled', '1');
    console.log('🤖 Agente IA: ✅ ENCENDIDO');
  }

  async disable(): Promise<void> {
    await this.redis.set('agent:enabled', '0');
    console.log('🤖 Agente IA: 🔴 APAGADO');
  }

  async toggle(): Promise<boolean> {
    const current = await this.isEnabled();
    if (current) {
      await this.disable();
      return false;
    } else {
      await this.enable();
      return true;
    }
  }
}
