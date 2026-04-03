import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

export type CampaignJob = {
  campaignContactId: number;
  phone: string;
  name: string;
  message: string;
  imageUrl?: string;
  campaignId: number;
};

@Injectable()
export class CampaignsService implements OnModuleInit {
  private queue: Queue;

  async onModuleInit() {
    this.queue = new Queue('campaigns', {
      connection: {
        url: process.env.REDIS_URL,
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
      },
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 30000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });

    console.log('📣 Cola de campañas lista');
  }

  async enqueueBatch(payload: {
    campaignId: number;
    contacts: { campaignContactId: number; phone: string; name: string }[];
    message: string;
    imageUrl?: string;
  }): Promise<{ queued: number }> {
    const { campaignId, contacts, message, imageUrl } = payload;

    // Encolar con delay incremental — 60s entre cada mensaje
    const DELAY_MS = 60000;

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      await this.queue.add(
        'send-message',
        {
          campaignContactId: contact.campaignContactId,
          phone: contact.phone,
          name: contact.name,
          message,
          imageUrl,
          campaignId,
        } as CampaignJob,
        { delay: i * DELAY_MS },
      );
    }

    console.log(
      `📣 Encolados ${contacts.length} mensajes para campaña ${campaignId}`,
    );
    return { queued: contacts.length };
  }
}
