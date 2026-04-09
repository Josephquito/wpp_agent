import { Module } from '@nestjs/common';
import { CampaignTrackerService } from './campaign-tracker.service';
import { ChatwootModule } from '../chatwoot/chatwoot.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ChatwootModule, ConfigModule],
  providers: [CampaignTrackerService],
  exports: [CampaignTrackerService],
})
export class CampaignsModule {}
