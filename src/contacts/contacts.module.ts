// src/contacts/contacts.module.ts
import { Module } from '@nestjs/common';
import { ContactTrackerService } from './contact-tracker.service';
import { GoogleModule } from '../google/google.module';

@Module({
  imports: [GoogleModule],
  providers: [ContactTrackerService],
  exports: [ContactTrackerService],
})
export class ContactsModule {}
