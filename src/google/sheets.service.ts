// src/google/sheets.service.ts
import { Injectable } from '@nestjs/common';
import { google, sheets_v4 } from 'googleapis';
import { GoogleAuthService } from './google-auth.service';
import { normalizePhone } from '../common/normalize-phone';

const SPREADSHEET_ID = '1dkGj__sKFnJROe9Rn0OYOPYlsdQzlA-KsvjBxXs3zj8';
const HOJA_CONTACTOS = 'CONTACTOS';
const RANGO_DATOS = `${HOJA_CONTACTOS}!A2:B`;
// Columna auxiliar con la lista combinada (nombres + telefonos) como
// VALORES ESTATICOS, para que la validacion de datos en las pestañas
// de plataforma no dependa de una formula que se recalcule todo el rato.
const RANGO_LISTA_VALIDACION = `${HOJA_CONTACTOS}!D2:D30000`;

@Injectable()
export class SheetsService {
  private sheets: sheets_v4.Sheets;

  constructor(private readonly googleAuth: GoogleAuthService) {
    this.sheets = google.sheets({
      version: 'v4',
      auth: this.googleAuth.getAuthClient(),
    });
  }

  async getClientPhones(): Promise<string[]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGO_DATOS,
    });

    const filas = res.data.values || [];
    return filas
      .map((fila) => fila[1])
      .filter(Boolean)
      .map((tel) => normalizePhone(tel));
  }

  async registerContact(params: {
    contactId: string;
    nombre: string;
  }): Promise<void> {
    const telefono = normalizePhone(params.contactId);

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGO_DATOS,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[params.nombre, telefono]],
      },
    });
  }

  /**
   * Sobrescribe TODA la pestaña CONTACTOS con la lista completa recibida
   * (columnas A y B), y además regenera la columna D como lista estática
   * (nombres + telefonos apilados) para que la validación de datos de
   * las pestañas de plataforma sea rápida (sin fórmulas que recalcular).
   */
  async overwriteContacts(
    contactos: { nombre: string; telefono: string }[],
  ): Promise<void> {
    // 1. Limpiar A:B y D antes de escribir
    await this.sheets.spreadsheets.values.batchClear({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        ranges: [RANGO_DATOS, RANGO_LISTA_VALIDACION],
      },
    });

    if (contactos.length === 0) return;

    // 2. Escribir A:B (Nombre, Telefono)
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGO_DATOS,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: contactos.map((c) => [c.nombre, c.telefono]),
      },
    });

    // 3. Escribir D como lista estática combinada (nombres, luego telefonos)
    const listaValidacion = [
      ...contactos.map((c) => [c.nombre]),
      ...contactos.map((c) => [c.telefono]),
    ];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${HOJA_CONTACTOS}!D2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: listaValidacion,
      },
    });
  }
}
