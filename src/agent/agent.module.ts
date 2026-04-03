// src/agent/agent.module.ts
import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { CompraHandler } from './handlers/compra.handler';
import { PagoHandler } from './handlers/pago.handler';
import { InfoHandler } from './handlers/info.handler';
import { StateHandler } from './handlers/state.handler';
import { ConversacionalHandler } from './handlers/conversacional.handler';
import { ChatwootModule } from '../chatwoot/chatwoot.module';
import { HistoryModule } from '../history/history.module';
import { OpenaiModule } from '../openai/openai.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ChatwootModule, HistoryModule, OpenaiModule, ConfigModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    CompraHandler,
    PagoHandler,
    InfoHandler,
    StateHandler,
    ConversacionalHandler,
  ],
  exports: [
    AgentService,
    CompraHandler,
    PagoHandler,
    InfoHandler,
    StateHandler,
    ConversacionalHandler,
  ],
})
export class AgentModule {}
