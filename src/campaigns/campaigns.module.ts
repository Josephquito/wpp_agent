import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignProcessor } from './campaign.processor';
import { CampaignTrackerService } from './campaign-tracker.service';
import { ChatwootModule } from '../chatwoot/chatwoot.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ChatwootModule, ConfigModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignProcessor, CampaignTrackerService],
  exports: [CampaignsService, CampaignTrackerService],
})
export class CampaignsModule {}
