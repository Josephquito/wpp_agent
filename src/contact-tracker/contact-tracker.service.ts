import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ContactTrackerService {
  private sheets: any;
  private spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // Cache local para evitar llamadas a Sheets en cada mensaje
  private knownContacts = new Set<string>();
  private cacheLoaded = false;

  constructor() {
    const credentials = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../credentials.json'),
        'utf-8',
      ),
    );
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheets = google.sheets({ version: 'v4', auth });
  }

  // ── Cargar contactos existentes al arrancar ────────────────────────────────

  async loadKnownContacts(): Promise<void> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'DB_Contactos!B:B',
      });

      const phones: string[] = (response.data.values || [])
        .flat()
        .map((p: string) => p.trim())
        .filter(Boolean);

      phones.forEach((p) => this.knownContacts.add(p));
      this.cacheLoaded = true;

      console.log(`👥 Contactos cargados: ${this.knownContacts.size}`);
    } catch (error) {
      console.error('❌ Error loadKnownContacts:', error.message);
    }
  }

  // ── Registrar contacto nuevo si no existe ─────────────────────────────────

  registerIfNew(contactId: string, nombre: string): void {
    if (!this.cacheLoaded) {
      // Si el cache aún no cargó, cargar y reintentar
      this.loadKnownContacts().then(() =>
        this.registerIfNew(contactId, nombre),
      );
      return;
    }

    if (this.knownContacts.has(contactId.trim())) return;

    // Agregar al Set local inmediatamente para evitar duplicados por concurrencia
    this.knownContacts.add(contactId.trim());

    // Persistir en Sheets (no bloqueante)
    const row = [new Date().toISOString(), contactId, nombre];

    this.sheets.spreadsheets.values
      .append({
        spreadsheetId: this.spreadsheetId,
        range: 'DB_Contactos!A1',
        valueInputOption: 'RAW',
        resource: { values: [row] },
      })
      .then(() => console.log(`👤 Nuevo contacto: [${contactId}] ${nombre}`))
      .catch((err: Error) =>
        console.error('❌ Error guardar contacto:', err.message),
      );
  }
}
