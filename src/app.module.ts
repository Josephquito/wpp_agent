import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WebhookModule } from './webhook/webhook.module';
import { GoogleSheetsService } from './google-sheets/google-sheets.service';
import { OpenaiService } from './openai/openai.service';

@Module({
  imports: [WebhookModule],
  controllers: [AppController],
  providers: [AppService, GoogleSheetsService, OpenaiService],
})
export class AppModule {}
