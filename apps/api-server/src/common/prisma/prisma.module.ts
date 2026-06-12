import { Global, Module } from '@nestjs/common';
import { ControlPrismaService } from './control-prisma.service';
import { ClientPrismaFactory } from './client-prisma.factory';

@Global()
@Module({
  providers: [ControlPrismaService, ClientPrismaFactory],
  exports: [ControlPrismaService, ClientPrismaFactory],
})
export class PrismaModule {}
