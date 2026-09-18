import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { MediaModule } from '../media/media.module'
import { PackagingPaymentProfileController, PaymentRecipientImageController, SupplierPaymentProfileController } from './payment-recipient.controller'
import { PackagingPaymentProfileService } from './packaging-payment-profile.service'
import { PaymentRecipientService } from './payment-recipient.service'
import { PaymentRecipientImageService } from './payment-recipient-image.service'

@Module({ imports: [PrismaModule, AuthModule, DictionaryModule, MediaModule],
  controllers: [PackagingPaymentProfileController, SupplierPaymentProfileController, PaymentRecipientImageController],
  providers: [PackagingPaymentProfileService, PaymentRecipientService, PaymentRecipientImageService], exports: [PackagingPaymentProfileService, PaymentRecipientService] })
export class PaymentRecipientsModule {}
