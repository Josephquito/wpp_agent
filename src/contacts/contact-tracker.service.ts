// src/contacts/contact-tracker.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ContactTrackerService implements OnModuleInit {
  private knownContacts = new Set<string>();
  private blockedNumbers = new Set<string>();

  async onModuleInit() {
    await this.loadBlockedNumbers();
    setInterval(() => this.loadBlockedNumbers(), 3600000);
  }

  private async loadBlockedNumbers(): Promise<void> {
    try {
      const res = await axios.get(
        `${process.env.INTRANET_URL}/suppliers/contacts`,
        {
          headers: { 'x-api-key': process.env.INTRANET_API_KEY },
          timeout: 5000,
        },
      );
      this.blockedNumbers = new Set(res.data.contacts);
      console.log(`🚫 Números bloqueados: ${this.blockedNumbers.size}`);
    } catch (err) {
      console.error(`❌ Error cargando bloqueados: ${err.message}`);
    }
  }

  isBlocked(phone: string): boolean {
    return this.blockedNumbers.has(phone.trim());
  }

  registerIfNew(contactId: string, nombre: string): void {
    const phone = contactId.trim();

    if (this.isBlocked(phone)) return;
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
