// src/contacts/contact-tracker.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { SheetsService } from '../google/sheets.service';
import { ContactsService } from '../google/contacts.service';
import { normalizePhone } from '../common/normalize-phone';

const UNA_HORA = 3600000;
const PATRON_CLIENTE = /^cliente\s+(\d+)$/i;

@Injectable()
export class ContactTrackerService implements OnModuleInit {
  private knownContacts = new Set<string>();
  private usedClienteNumbers = new Set<number>();

  constructor(
    private readonly sheetsService: SheetsService,
    private readonly contactsService: ContactsService,
  ) {}

  async onModuleInit() {
    await this.syncFromGoogleContacts();
    setInterval(() => this.syncFromGoogleContacts(), UNA_HORA);
  }

  /**
   * Trae TODOS los contactos reales desde Google Contacts, sobrescribe
   * la pestaña CONTACTOS del Sheet, recarga el Set de teléfonos en
   * memoria, y recalcula qué números "Cliente N" ya están en uso.
   */
  private async syncFromGoogleContacts(): Promise<void> {
    try {
      const contactos = await this.contactsService.listAllContacts();
      await this.sheetsService.overwriteContacts(contactos);

      this.knownContacts = new Set(contactos.map((c) => c.telefono));

      this.usedClienteNumbers = new Set();
      for (const c of contactos) {
        const match = c.nombre.match(PATRON_CLIENTE);
        if (match) {
          this.usedClienteNumbers.add(parseInt(match[1], 10));
        }
      }

      console.log(
        `🔄 Sincronizado desde Google Contacts: ${this.knownContacts.size} contactos (${this.usedClienteNumbers.size} con numeración "Cliente N")`,
      );
    } catch (err: any) {
      console.error(
        `❌ Error sincronizando desde Google Contacts: ${err.message}`,
      );
    }
  }

  /**
   * Devuelve el primer número disponible desde el 1 hacia arriba que no
   * esté en uso (rellena huecos de contactos borrados antes de asignar
   * uno nuevo al final de la secuencia).
   */
  private getNextClienteNumber(): number {
    let n = 1;
    while (this.usedClienteNumbers.has(n)) n++;
    return n;
  }

  exists(phone: string): boolean {
    return this.knownContacts.has(normalizePhone(phone));
  }

  /**
   * Registra un contacto nuevo si su teléfono no existe todavía.
   * El nombre se asigna automáticamente como "Cliente N", usando el
   * primer número libre disponible (rellenando huecos primero).
   */
  async registerIfNew(contactId: string): Promise<void> {
    const phone = normalizePhone(contactId);

    if (this.exists(phone)) return;

    const numero = this.getNextClienteNumber();
    const nombre = `Cliente ${numero}`;

    this.knownContacts.add(phone);
    this.usedClienteNumbers.add(numero);

    try {
      await this.sheetsService.registerContact({ contactId: phone, nombre });
      await this.contactsService.createContact({ contactId: phone, nombre });
      console.log(`👤 Contacto nuevo registrado: [${phone}] ${nombre}`);
    } catch (err: any) {
      this.knownContacts.delete(phone);
      this.usedClienteNumbers.delete(numero);
      console.error(`❌ Error registrando contacto: ${err.message}`);
    }
  }
}
