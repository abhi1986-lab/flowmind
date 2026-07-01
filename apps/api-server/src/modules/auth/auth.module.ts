import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ClientResolverModule } from '../client-resolver/client-resolver.module';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    ClientResolverModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      // async to satisfy the JwtModuleAsyncOptions type (union allows Promise or value); disable for no await
      // eslint-disable-next-line @typescript-eslint/require-await
      useFactory: async (config: ConfigService) => ({
        secret: config.get<string>(
          'JWT_SECRET',
          'dev-super-secret-change-in-real-env',
        ),
        signOptions: {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') as any,
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
