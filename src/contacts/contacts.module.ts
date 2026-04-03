// src/contacts/contacts.module.ts
import { Module } from '@nestjs/common';
import { ContactTrackerService } from './contact-tracker.service';

@Module({
  providers: [ContactTrackerService],
  exports: [ContactTrackerService],
})
export class ContactsModule {}
