import { Module } from '@nestjs/common';
import { ClientResolverService } from './client-resolver.service';
import { ClientResolverGuard } from './client-resolver.guard';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ClientResolverService, ClientResolverGuard],
  exports: [ClientResolverService, ClientResolverGuard],
})
export class ClientResolverModule {}
