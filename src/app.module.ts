// src/app.module.ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WebhookModule } from './webhook/webhook.module';
import { AgentModule } from './agent/agent.module';
import { CampaignsModule } from './campaigns/campaigns.module';

@Module({
  imports: [WebhookModule, AgentModule, CampaignsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
