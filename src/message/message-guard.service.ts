import { Injectable, OnModuleInit } from '@nestjs/common';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

type DebounceEntry = {
  timer: NodeJS.Timeout;
  messages: string[];
  resolve: (text: string) => void;
};

@Injectable()
export class MessageGuardService implements OnModuleInit {
  private sheets: any;
  private spreadsheetId = process.env.GOOGLE_SHEET_ID;

  private blacklist = new Set<string>();
  private spamTracker = new Map<string, number[]>();
  private debounceMap = new Map<string, DebounceEntry>();

  private debounceMs = 3000;
  private spamLimit = 5;
  private spamWindowMs = 60000;

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
    await this.loadBlacklist();
  }

  async loadBlacklist(): Promise<void> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'DB_Blacklist!A:A',
      });

      const phones: string[] = (response.data.values || [])
        .flat()
        .map((p: string) => p.trim())
        .filter(Boolean);

      phones.forEach((p) => this.blacklist.add(p));
      console.log(`🚫 Blacklist cargada: ${this.blacklist.size} contactos`);
    } catch (error) {
      console.error('❌ Error loadBlacklist:', error.message);
    }
  }

  setConfig(debounceMs: number, spamLimit: number): void {
    if (this.debounceMs === debounceMs && this.spamLimit === spamLimit) return;
    this.debounceMs = debounceMs;
    this.spamLimit = spamLimit;
    console.log(
      `⚙️ MessageGuard config actualizada: debounce=${debounceMs}ms, spamLimit=${spamLimit}`,
    );
  }

  isBlacklisted(contactId: string): boolean {
    return this.blacklist.has(contactId.trim());
  }

  isSpam(contactId: string): boolean {
    const now = Date.now();
    const timestamps = this.spamTracker.get(contactId) || [];

    const recent = timestamps.filter((t) => now - t < this.spamWindowMs);
    recent.push(now);
    this.spamTracker.set(contactId, recent);

    if (recent.length > this.spamLimit) {
      console.log(
        `🚨 SPAM detectado: [${contactId}] — ${recent.length} mensajes en 1 min`,
      );
      return true;
    }

    return false;
  }

  debounce(contactId: string, message: string): Promise<string> {
    return new Promise((resolve) => {
      const existing = this.debounceMap.get(contactId);

      if (existing) {
        clearTimeout(existing.timer);
        existing.messages.push(message);

        const timer = setTimeout(() => {
          const accumulated = this.debounceMap.get(contactId);
          if (accumulated) {
            const fullText = accumulated.messages.join(' ');
            this.debounceMap.delete(contactId);
            accumulated.resolve(fullText);
          }
        }, this.debounceMs);

        this.debounceMap.set(contactId, {
          timer,
          messages: existing.messages,
          resolve: existing.resolve,
        });
      } else {
        const messages = [message];

        const timer = setTimeout(() => {
          const accumulated = this.debounceMap.get(contactId);
          if (accumulated) {
            const fullText = accumulated.messages.join(' ');
            this.debounceMap.delete(contactId);
            accumulated.resolve(fullText);
          }
        }, this.debounceMs);

        this.debounceMap.set(contactId, { timer, messages, resolve });
      }
    });
  }

  async reloadBlacklist(): Promise<void> {
    this.blacklist.clear();
    await this.loadBlacklist();
  }

  // ── Human Takeover ────────────────────────────────────────────────────────
  private takeoverMap = new Map<string, number>();

  registerAgentMessage(contactId: string, takeoverMs: number): void {
    this.takeoverMap.set(contactId, Date.now());
    console.log(
      `🤝 Takeover activado: [${contactId}] bot pausado por ${takeoverMs / 60000} min`,
    );
  }

  isBotPaused(contactId: string, takeoverMs: number): boolean {
    const lastAgent = this.takeoverMap.get(contactId);
    if (!lastAgent) return false;

    if (Date.now() - lastAgent > takeoverMs) {
      this.takeoverMap.delete(contactId);
      console.log(`🤖 Bot retoma control: [${contactId}]`);
      return false;
    }

    return true;
  }

  releaseTakeover(contactId: string): void {
    this.takeoverMap.delete(contactId);
    console.log(`🤖 Bot reactivado manualmente: [${contactId}]`);
  }
}
