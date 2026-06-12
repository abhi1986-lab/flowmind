import { Global, Module } from '@nestjs/common';
import { ControlPrismaService } from './control-prisma.service';

@Global()
@Module({
  providers: [ControlPrismaService],
  exports: [ControlPrismaService],
})
export class PrismaModule {}
