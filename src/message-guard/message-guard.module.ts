// src/message-guard/message-guard.module.ts
import { Module } from '@nestjs/common';
import { MessageGuardService } from './message-guard.service';

@Module({
  providers: [MessageGuardService],
  exports: [MessageGuardService],
})
export class MessageGuardModule {}
