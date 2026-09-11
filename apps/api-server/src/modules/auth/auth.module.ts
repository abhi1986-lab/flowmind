import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ClientResolverModule } from '../client-resolver/client-resolver.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { getJwtSecret } from '../../common/auth/jwt-secret';

@Module({
  imports: [
    PrismaModule,
    ClientResolverModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      // eslint-disable-next-line @typescript-eslint/require-await
      useFactory: async (_config: ConfigService) => ({
        // Fail-fast outside development when JWT_SECRET is missing (getJwtSecret).
        secret: getJwtSecret(),
        signOptions: {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          expiresIn: (_config.get<string>('JWT_EXPIRES_IN') || '7d') as any,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
