import { Global, Module } from '@nestjs/common';
import { ControlPrismaService } from './control-prisma.service';
import { ClientPrismaFactory } from './client-prisma.factory';
import { SecretRefsService } from '../secrets/secret-refs.service';

@Global()
@Module({
  providers: [ControlPrismaService, ClientPrismaFactory, SecretRefsService],
  exports: [ControlPrismaService, ClientPrismaFactory, SecretRefsService],
})
export class PrismaModule {}
