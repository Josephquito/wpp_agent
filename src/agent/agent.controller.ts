// src/agent/agent.controller.ts
import {
  Controller,
  Post,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  private checkApiKey(apiKey: string): void {
    const expected = process.env.BOT_API_KEY;
    if (!expected || apiKey !== expected) {
      throw new UnauthorizedException('API key inválida');
    }
  }

  @Get('status')
  async getStatus(@Headers('x-api-key') apiKey: string) {
    this.checkApiKey(apiKey);
    const enabled = await this.agentService.isEnabled();
    return { enabled };
  }

  @Post('toggle')
  async toggle(@Headers('x-api-key') apiKey: string) {
    this.checkApiKey(apiKey);
    const enabled = await this.agentService.toggle();
    return {
      enabled,
      message: enabled ? '✅ Agente encendido' : '🔴 Agente apagado',
    };
  }

  @Post('enable')
  async enable(@Headers('x-api-key') apiKey: string) {
    this.checkApiKey(apiKey);
    await this.agentService.enable();
    return { enabled: true, message: '✅ Agente encendido' };
  }

  @Post('disable')
  async disable(@Headers('x-api-key') apiKey: string) {
    this.checkApiKey(apiKey);
    await this.agentService.disable();
    return { enabled: false, message: '🔴 Agente apagado' };
  }
}
