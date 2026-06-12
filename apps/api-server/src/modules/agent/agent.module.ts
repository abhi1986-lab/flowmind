import { Module } from '@nestjs/common';
import { AgentSessionsController } from './agent-sessions.controller';
import { AuthModule } from '../auth/auth.module';
import { ClientResolverModule } from '../client-resolver/client-resolver.module';
import { TimelineBuilder } from './timeline.builder';
import { SopDraftGenerator } from './sop.generator';

@Module({
  imports: [AuthModule, ClientResolverModule],
  controllers: [AgentSessionsController],
  providers: [TimelineBuilder, SopDraftGenerator],
})
export class AgentModule {}
