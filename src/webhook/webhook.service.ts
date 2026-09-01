// src/webhook/webhook.service.ts
import { Injectable } from '@nestjs/common';
import { ContactTrackerService } from '../contacts/contact-tracker.service';
import { normalizePhone } from '../common/normalize-phone';

@Injectable()
export class WebhookService {
  constructor(private readonly contactTracker: ContactTrackerService) {}

  async handleIncomingMessage(body: any): Promise<{ status: string }> {
    if (body?.object !== 'whatsapp_business_account') {
      return { status: 'ignored' };
    }

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const messages = value?.messages;
    if (!messages || messages.length === 0) {
      return { status: 'ignored' };
    }

    const message = messages[0];
    const waId: string = message?.from;
    if (!waId) return { status: 'no_data' };

    const contactId = normalizePhone(waId);
    const texto: string = message?.text?.body || '(sin texto / adjunto)';

    console.log(`✅ Mensaje de [${contactId}]: "${texto}"`);

    await this.contactTracker.registerIfNew(contactId);

    return { status: 'ok' };
  }
}
