import {
  Controller,
  Post,
  Body,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  private checkApiKey(apiKey: string): void {
    const expected = process.env.BOT_API_KEY;
    if (!expected || apiKey !== expected) {
      throw new UnauthorizedException('API key inválida');
    }
  }

  @Post('send')
  async sendBatch(
    @Body()
    body: {
      campaignId: number;
      contacts: {
        campaignContactId: number;
        phone: string;
        name: string;
      }[];
      message: string;
      imageUrl?: string;
    },
    @Headers('x-api-key') apiKey: string,
  ) {
    this.checkApiKey(apiKey);
    return this.campaignsService.enqueueBatch(body);
  }
}
