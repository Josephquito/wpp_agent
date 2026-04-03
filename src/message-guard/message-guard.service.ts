// src/message-guard/message-guard.service.ts
import { Injectable } from '@nestjs/common';

type DebounceEntry = {
  timer: NodeJS.Timeout;
  messages: string[];
  resolve: (text: string) => void;
};

@Injectable()
export class MessageGuardService {
  private spamTracker = new Map<string, number[]>();
  private debounceMap = new Map<string, DebounceEntry>();
  private takeoverMap = new Map<string, number>();

  private debounceMs = 3000;
  private spamLimit = 5;
  private spamWindowMs = 60000;

  setConfig(debounceMs: number, spamLimit: number): void {
    if (this.debounceMs === debounceMs && this.spamLimit === spamLimit) return;
    this.debounceMs = debounceMs;
    this.spamLimit = spamLimit;
  }

  isSpam(contactId: string): boolean {
    const now = Date.now();
    const timestamps = this.spamTracker.get(contactId) || [];
    const recent = timestamps.filter((t) => now - t < this.spamWindowMs);
    recent.push(now);
    this.spamTracker.set(contactId, recent);
    if (recent.length > this.spamLimit) {
      console.log(`🚨 SPAM: [${contactId}] — ${recent.length} msgs en 1 min`);
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
          const acc = this.debounceMap.get(contactId);
          if (acc) {
            const fullText = acc.messages.join(' ');
            this.debounceMap.delete(contactId);
            acc.resolve(fullText);
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
          const acc = this.debounceMap.get(contactId);
          if (acc) {
            const fullText = acc.messages.join(' ');
            this.debounceMap.delete(contactId);
            acc.resolve(fullText);
          }
        }, this.debounceMs);
        this.debounceMap.set(contactId, { timer, messages, resolve });
      }
    });
  }

  registerAgentMessage(contactId: string, takeoverMs: number): void {
    this.takeoverMap.set(contactId, Date.now());
    console.log(`🤝 Takeover: [${contactId}] pausado ${takeoverMs / 60000}min`);
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
    console.log(`🤖 Bot reactivado: [${contactId}]`);
  }
}
