import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { GoogleSheetsService } from 'src/google-sheets/google-sheets.service';
import { OpenaiService } from 'src/openai/openai.service';
import { ContactTrackerService } from 'src/contact-tracker/contact-tracker.service';
import { MessageGuardService } from 'src/message/message-guard.service';
import { HistoryService } from 'src/history/history.service';

@Module({
  controllers: [WebhookController],
  providers: [
    ContactTrackerService,
    GoogleSheetsService,
    HistoryService,
    MessageGuardService,
    OpenaiService,
  ],
})
export class WebhookModule {}
