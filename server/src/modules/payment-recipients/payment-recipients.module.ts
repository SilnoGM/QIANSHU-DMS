import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { MediaModule } from '../media/media.module'
import { PaymentRecipientImageController, SupplierPaymentProfileController } from './payment-recipient.controller'
import { PaymentRecipientService } from './payment-recipient.service'
import { PaymentRecipientImageService } from './payment-recipient-image.service'

@Module({ imports: [PrismaModule, AuthModule, DictionaryModule, MediaModule],
  controllers: [SupplierPaymentProfileController, PaymentRecipientImageController],
  providers: [PaymentRecipientService, PaymentRecipientImageService], exports: [PaymentRecipientService] })
export class PaymentRecipientsModule {}
