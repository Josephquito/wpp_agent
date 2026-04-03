import { Injectable, OnModuleInit } from '@nestjs/common';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import Fuse from 'fuse.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type Intent =
  | 'COMPRA'
  | 'PAGO'
  | 'SOPORTE'
  | 'INFO'
  | 'OFFTOPIC'
  | 'CONVERSACIONAL';

export interface ProductoDetalle {
  nombre: string;
  cantidad: number;
  tipo: string;
}

export interface ClassifyResult {
  intent: Intent;
  productos: string[];
  productosDetalle: ProductoDetalle[];
  banco: string | null;
  cantidad: number | null;
  tipo: string | null;
}

export interface ProductoRow {
  id: string;
  nombre: string;
  precio: string;
  reglasVenta: string;
  reglasCliente: string;
  keywords: string;
}

export interface PagoRow {
  id: string;
  plantilla: string;
  keywords: string[];
  contenido: string;
}

export interface InfoRow {
  id: string;
  titulo: string;
  contenido: string;
  keywords: string[];
}

export interface ConfigMap {
  [clave: string]: string;
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable()
export class GoogleSheetsService implements OnModuleInit {
  private sheets: any;
  private spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // Cache de datos de Sheets
  private cache = {
    productos: [] as ProductoRow[],
    pagos: [] as PagoRow[],
    info: [] as InfoRow[],
    config: {} as ConfigMap,
  };

  // Índice Fuse.js para búsqueda fuzzy sobre nombres de productos
  private fuseProductos: Fuse<ProductoRow> | null = null;

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

  async onModuleInit() {
    await this.refreshCache();
  }

  // ─── Refresh cache ──────────────────────────────────────────────────────────

  async refreshCache(): Promise<void> {
    try {
      const response = await this.sheets.spreadsheets.values.batchGet({
        spreadsheetId: this.spreadsheetId,
        ranges: [
          'DB_Productos!A2:F',
          'DB_Pagos!A2:D',
          'DB_Info!A2:D',
          'DB_Config!A2:B',
        ],
      });

      const [rawProductos, rawPagos, rawInfo, rawConfig] =
        response.data.valueRanges.map((vr: any) => vr.values || []);

      this.cache.productos = rawProductos.map((r: string[]) => ({
        id: r[0] || '',
        nombre: r[1] || '',
        precio: r[2] || '',
        reglasVenta: r[3] || '',
        reglasCliente: r[4] || '', // ← columna E
        keywords: r[5] || '',
      }));

      this.cache.pagos = rawPagos.map((r: string[]) => ({
        id: r[0] || '',
        plantilla: r[1] || '',
        keywords: (r[2] || '')
          .split(',')
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean),
        contenido: r[3] || '',
      }));

      this.cache.info = rawInfo.map((r: string[]) => ({
        id: r[0] || '',
        titulo: r[1] || '',
        contenido: r[2] || '',
        keywords: (r[3] || '')
          .split(',')
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean),
      }));

      this.cache.config = Object.fromEntries(
        rawConfig
          .filter((r: string[]) => r[0])
          .map((r: string[]) => [r[0].trim(), r[1]?.trim() || '']),
      );

      this.fuseProductos = new Fuse(this.cache.productos, {
        keys: ['nombre', 'keywords'],
        threshold: 0.4,
        minMatchCharLength: 3,
      });

      console.log(
        `✅ Caché actualizada — productos: ${this.cache.productos.length}, ` +
          `pagos: ${this.cache.pagos.length}, info: ${this.cache.info.length}, ` +
          `config keys: ${Object.keys(this.cache.config).length}`,
      );
    } catch (error) {
      console.error('❌ Error refreshCache:', error.message);
    }
  }

  // ─── Config ─────────────────────────────────────────────────────────────────

  getConfig(clave: string): string {
    return this.cache.config[clave] ?? '';
  }

  // ─── Búsqueda de productos ───────────────────────────────────────────────────

  findProducto(productoNormalizado: string): ProductoRow | null {
    if (!productoNormalizado) return null;
    const query = productoNormalizado.toLowerCase().trim();

    // 1. Match exacto por nombre
    let match = this.cache.productos.find((p) =>
      p.nombre.toLowerCase().includes(query),
    );

    // 2. Match exacto por keyword ← nuevo
    if (!match) {
      match = this.cache.productos.find((p) =>
        p.keywords
          .toLowerCase()
          .split(',')
          .map((k) => k.trim())
          .includes(query),
      );
    }

    // 3. Fuse fuzzy
    if (!match && this.fuseProductos) {
      const results = this.fuseProductos.search(query);
      if (results.length > 0) match = results[0].item;
    }

    return match || null;
  }

  // ─── Búsqueda de plantilla de pago ──────────────────────────────────────────

  findPlantillaPago(bancoNormalizado: string | null): string | null {
    const query = bancoNormalizado?.toLowerCase().trim() || '';

    let row: PagoRow | undefined;

    if (query) {
      row = this.cache.pagos.find((p) =>
        p.keywords.some((k) => query.includes(k) || k.includes(query)),
      );
    }

    if (!row) {
      row = this.cache.pagos.find((p) => p.plantilla === '1');
    }

    return row?.contenido || null;
  }

  // ─── Búsqueda de info del negocio ───────────────────────────────────────────

  findInfo(userMessage: string, productos?: string[]): string | null {
    const msg = userMessage.toLowerCase().trim();
    const words = msg.split(/\s+/).filter((w) => w.length > 3);

    // 1. Buscar en DB_Info primero
    const matches = this.cache.info.filter(
      (row) =>
        row.keywords.some((k) => msg.includes(k)) ||
        words.some((w) => row.titulo.toLowerCase().includes(w)),
    );

    const infoTexto =
      matches.length > 0
        ? matches
            .map((r) => `Título: ${r.titulo} | Info: ${r.contenido}`)
            .join('\n')
        : null;

    // 2. Buscar reglas del producto si hay productos en contexto
    let reglasTexto: string | null = null;
    if (productos && productos.length > 0) {
      const reglas: string[] = [];
      for (const nombre of productos) {
        const productoRow = this.findProducto(nombre);
        if (productoRow?.reglasCliente) {
          reglas.push(
            `Producto: ${productoRow.nombre}\nInfo para cliente: ${productoRow.reglasCliente}`,
          );
        }
      }
      if (reglas.length > 0) reglasTexto = reglas.join('\n');
    }

    // 3. Combinar lo que encontró
    const resultado = [infoTexto, reglasTexto].filter(Boolean).join('\n');
    return resultado || null;
  }

  // ─── Log — solo persiste en Sheets, historial lo maneja HistoryService ──────

  logInteraction(params: {
    contactId: string;
    nombre: string;
    mensaje: string;
    intent: Intent | string;
    respuesta: string;
  }): void {
    const { contactId, nombre, mensaje, intent, respuesta } = params;

    const row = [
      new Date().toISOString(),
      contactId,
      nombre,
      mensaje,
      intent,
      respuesta,
    ];

    this.sheets.spreadsheets.values
      .append({
        spreadsheetId: this.spreadsheetId,
        range: 'Historial_Chat!A1',
        valueInputOption: 'RAW',
        resource: { values: [row] },
      })
      .catch((err: Error) =>
        console.error('❌ Error log Sheets:', err.message),
      );
  }

  // ─── Precio helpers ──────────────────────────────────────────────────────────

  findPrecioExacto(
    precioTexto: string,
    cantidad: number,
    tipo: string,
  ): boolean {
    return this.findPrecioValor(precioTexto, cantidad, tipo) !== null;
  }

  findPrecioUnitario(precioTexto: string): number | null {
    if (!precioTexto) return null;

    const match = precioTexto.match(
      /1\s*mes[^$\d]*\$?\s*([\d]+[.,][\d]{1,2})/i,
    );
    if (!match) return null;

    const valor = parseFloat(match[1].replace(',', '.'));
    return isNaN(valor) ? null : valor;
  }

  findPrecioValor(
    precioTexto: string,
    cantidad: number,
    tipo: string,
  ): number | null {
    if (!precioTexto || !cantidad || !tipo) return null;

    const lineas = precioTexto.split('\n');
    const tipoNorm = tipo.toLowerCase();

    for (const linea of lineas) {
      const lineaNorm = linea.toLowerCase();

      const coincide =
        new RegExp(`${cantidad}\\s*${tipoNorm}`).test(lineaNorm) ||
        new RegExp(`${cantidad}\\s*mes(?:es)?`).test(lineaNorm) ||
        new RegExp(`${cantidad}\\s*dispositivo`).test(lineaNorm) ||
        new RegExp(`${cantidad}\\s*pantalla`).test(lineaNorm) ||
        new RegExp(`${cantidad}\\s*perfil`).test(lineaNorm);

      if (coincide) {
        const match = linea.match(/\$\s*([\d]+[.,][\d]{1,2})/);
        if (match) return parseFloat(match[1].replace(',', '.'));
      }
    }

    return null;
  }
}
