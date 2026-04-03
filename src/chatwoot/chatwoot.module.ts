// src/chatwoot/chatwoot.module.ts
import { Module } from '@nestjs/common';
import { ChatwootService } from './chatwoot.service';
import { HistoryModule } from '../history/history.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [HistoryModule, ConfigModule],
  providers: [ChatwootService],
  exports: [ChatwootService],
})
export class ChatwootModule {}
