// src/webhook/webhook.module.ts
import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { AgentModule } from '../agent/agent.module';
import { ContactsModule } from '../contacts/contacts.module';
import { HistoryModule } from '../history/history.module';
import { MessageGuardModule } from '../message-guard/message-guard.module';
import { ConfigModule } from '../config/config.module';
import { OpenaiModule } from '../openai/openai.module';
import { CampaignsModule } from 'src/campaigns/campaigns.module';

@Module({
  imports: [
    AgentModule,
    ContactsModule,
    HistoryModule,
    MessageGuardModule,
    ConfigModule,
    OpenaiModule,
    CampaignsModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
