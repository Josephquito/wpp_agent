// src/contacts/contact-tracker.service.ts
import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ContactTrackerService {
  private knownContacts = new Set<string>();
  registerIfNew(contactId: string, nombre: string): void {
    const phone = contactId.trim();
    if (this.knownContacts.has(phone)) return;

    this.knownContacts.add(phone);

    axios
      .post(
        `${process.env.INTRANET_URL}/customers/from-bot`,
        { name: nombre, contact: phone },
        {
          headers: { 'x-api-key': process.env.INTRANET_API_KEY },
          timeout: 5000,
        },
      )
      .then(() => console.log(`👤 Contacto → intranet: [${phone}] ${nombre}`))
      .catch((err) => {
        this.knownContacts.delete(phone);
        console.error(`❌ Error contacto intranet: ${err.message}`);
      });
  }
}
