// src/google/contacts.service.ts
import { Injectable } from '@nestjs/common';
import { google, people_v1 } from 'googleapis';
import { GoogleAuthService } from './google-auth.service';
import { normalizePhone } from '../common/normalize-phone';

@Injectable()
export class ContactsService {
  private people: people_v1.People;

  constructor(private readonly googleAuth: GoogleAuthService) {
    this.people = google.people({
      version: 'v1',
      auth: this.googleAuth.getAuthClient(),
    });
  }

  /**
   * Crea un contacto nuevo en Google Contacts con nombre y teléfono.
   */
  async createContact(params: {
    contactId: string; // ya normalizado, ej: "+593999130721"
    nombre: string;
  }): Promise<void> {
    await this.people.people.createContact({
      requestBody: {
        names: [{ givenName: params.nombre }],
        phoneNumbers: [{ value: params.contactId }],
      },
    });
  }

  /**
   * Trae TODOS los contactos de Google Contacts (paginado),
   * devolviendo nombre + teléfono normalizado de cada uno.
   * Solo incluye contactos que tengan al menos un teléfono.
   */
  async listAllContacts(): Promise<{ nombre: string; telefono: string }[]> {
    const resultado: { nombre: string; telefono: string }[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const res = await this.people.people.connections.list({
        resourceName: 'people/me',
        personFields: 'names,phoneNumbers',
        pageSize: 1000,
        pageToken,
      });

      const conexiones = res.data.connections || [];
      for (const persona of conexiones) {
        const nombre =
          persona.names?.[0]?.displayName ||
          persona.names?.[0]?.givenName ||
          'Sin nombre';
        const telefonos = persona.phoneNumbers || [];
        for (const tel of telefonos) {
          if (!tel.value) continue;
          resultado.push({ nombre, telefono: normalizePhone(tel.value) });
        }
      }

      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    return resultado;
  }
}
