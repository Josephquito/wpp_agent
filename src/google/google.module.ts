// src/google/google.module.ts
import { Module } from '@nestjs/common';
import { GoogleAuthService } from './google-auth.service';
import { SheetsService } from './sheets.service';
import { ContactsService } from './contacts.service';

@Module({
  providers: [GoogleAuthService, SheetsService, ContactsService],
  exports: [GoogleAuthService, SheetsService, ContactsService],
})
export class GoogleModule {}
