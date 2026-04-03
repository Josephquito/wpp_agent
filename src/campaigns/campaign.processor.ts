import { Injectable, OnModuleInit } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import axios from 'axios';
import FormData from 'form-data';
import { ChatwootService } from '../chatwoot/chatwoot.service';
import { GoogleSheetsService } from '../config/google-sheets.service';
import { CampaignJob } from './campaigns.service';

@Injectable()
export class CampaignProcessor implements OnModuleInit {
  constructor(
    private readonly chatwoot: ChatwootService,
    private readonly sheetsService: GoogleSheetsService,
  ) {}

  async onModuleInit() {
    new Worker(
      'campaigns',
      async (job: Job<CampaignJob>) => this.process(job),
      {
        connection: {
          url: process.env.REDIS_URL,
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD || undefined,
        },
        concurrency: 1,
      },
    );

    console.log('⚙️ Processor de campañas iniciado');
  }

  private async process(job: Job<CampaignJob>): Promise<void> {
    const { campaignContactId, phone, message, imageUrl, campaignId } =
      job.data;

    try {
      console.log(`📤 Procesando campaña ${campaignId} → [${phone}]`);

      const conversationId = await this.findOrCreateConversation(phone);
      console.log(`💬 ConversationId: ${conversationId} para [${phone}]`);

      if (!conversationId) {
        console.error(`❌ No se pudo obtener conversationId para [${phone}]`);
        await this.callbackFailed(
          campaignContactId,
          'No se pudo crear conversación en Chatwoot',
        );
        return;
      }

      const accountId = parseInt(process.env.CHATWOOT_ACCOUNT_ID || '1');

      if (imageUrl) {
        await this.sendWithImage(accountId, conversationId, message, imageUrl);
      } else {
        await this.chatwoot.send(accountId, conversationId, message);
      }

      console.log(
        `✅ Mensaje enviado a conversación ${conversationId} para [${phone}]`,
      );
      await this.callbackSent(campaignContactId);
    } catch (error) {
      console.error(
        `❌ Campaña ${campaignId} — error [${phone}]: ${error.message}`,
      );
      console.error(error.response?.data ?? error.stack);
      await this.callbackFailed(campaignContactId, error.message);
    }
  }

  private async sendWithImage(
    accountId: number,
    conversationId: number,
    message: string,
    imageUrl: string,
  ): Promise<void> {
    const url = `${process.env.CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
    const token = process.env.CHATWOOT_TOKEN;

    // Descargar imagen
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
    });

    const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
    const extension = contentType.split('/')[1]?.split(';')[0] || 'jpg';
    const filename = `flyer.${extension}`;

    // Armar form-data
    const form = new FormData();
    form.append('content', message);
    form.append('message_type', 'outgoing');
    form.append('private', 'false');
    form.append('attachments[]', Buffer.from(imageResponse.data), {
      filename,
      contentType,
    });

    await axios.post(url, form, {
      headers: {
        api_access_token: token,
        ...form.getHeaders(),
      },
      timeout: 15000,
    });
  }

  private async findOrCreateConversation(
    phone: string,
  ): Promise<number | null> {
    const url = process.env.CHATWOOT_URL;
    const token = process.env.CHATWOOT_TOKEN;
    const accountId = process.env.CHATWOOT_ACCOUNT_ID;
    const inboxId = process.env.CHATWOOT_INBOX_ID;

    const headers = { api_access_token: token };

    try {
      const searchRes = await axios.get(
        `${url}/api/v1/accounts/${accountId}/contacts/search`,
        { params: { q: phone, include_contacts: true }, headers },
      );

      let contactId: number | null = null;

      if (searchRes.data?.payload?.length > 0) {
        contactId = searchRes.data.payload[0].id;
      } else {
        const createRes = await axios.post(
          `${url}/api/v1/accounts/${accountId}/contacts`,
          { phone_number: phone },
          { headers },
        );
        contactId = createRes.data?.id ?? null;
      }

      if (!contactId) return null;

      const convsRes = await axios.get(
        `${url}/api/v1/accounts/${accountId}/contacts/${contactId}/conversations`,
        { headers },
      );

      const convs = convsRes.data?.payload ?? [];
      const active = convs.find(
        (c: any) => c.inbox_id === parseInt(inboxId!) && c.status === 'open',
      );

      if (active) return active.id;

      const newConvRes = await axios.post(
        `${url}/api/v1/accounts/${accountId}/conversations`,
        { contact_id: contactId, inbox_id: parseInt(inboxId!) },
        { headers },
      );

      return newConvRes.data?.id ?? null;
    } catch (error) {
      console.error(`❌ findOrCreateConversation [${phone}]: ${error.message}`);
      return null;
    }
  }

  private async callbackSent(campaignContactId: number): Promise<void> {
    await axios
      .post(
        `${process.env.INTRANET_URL}/campaigns/callback/sent`,
        { campaignContactId },
        {
          headers: { 'x-api-key': process.env.INTRANET_API_KEY },
          timeout: 5000,
        },
      )
      .catch((err) => console.error(`❌ callback sent: ${err.message}`));
  }

  private async callbackFailed(
    campaignContactId: number,
    reason: string,
  ): Promise<void> {
    await axios
      .post(
        `${process.env.INTRANET_URL}/campaigns/callback/failed`,
        { campaignContactId, reason },
        {
          headers: { 'x-api-key': process.env.INTRANET_API_KEY },
          timeout: 5000,
        },
      )
      .catch((err) => console.error(`❌ callback failed: ${err.message}`));
  }
}
