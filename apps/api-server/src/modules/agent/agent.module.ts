import { Module } from '@nestjs/common';
import { AgentSessionsController } from './agent-sessions.controller';
import { AuthModule } from '../auth/auth.module';
import { ClientResolverModule } from '../client-resolver/client-resolver.module';

@Module({
  imports: [AuthModule, ClientResolverModule],
  controllers: [AgentSessionsController],
})
export class AgentModule {}
