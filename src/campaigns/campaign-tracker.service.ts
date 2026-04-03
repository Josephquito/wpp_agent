import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class CampaignTrackerService {
  private readonly intranetUrl = process.env.INTRANET_URL;
  private readonly intranetApiKey = process.env.INTRANET_API_KEY;
  private readonly companyId = parseInt(process.env.BOT_COMPANY_ID || '1');

  notifyResponded(phone: string): void {
    axios
      .post(
        `${this.intranetUrl}/campaigns/callback/responded`,
        { phone, companyId: this.companyId },
        {
          headers: { 'x-api-key': this.intranetApiKey },
          timeout: 5000,
        },
      )
      .then((res) => {
        if (res.data?.marked) {
          console.log(`📣 Respondió campaña: [${phone}]`);
        }
      })
      .catch((err) => console.error(`❌ callback responded: ${err.message}`));
  }
}
