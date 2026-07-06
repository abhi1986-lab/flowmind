import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { IsString, IsOptional } from 'class-validator';
import type { AuthenticatedRequest } from '../client-resolver/client-resolver.guard';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

class LoginDto {
  @IsString()
  email!: string;

  @IsString()
  password!: string;

  // Optional explicit slug for very early dev without host routing
  @IsOptional()
  @IsString()
  clientSlug?: string;
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password, dto.clientSlug);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    // JwtAuthGuard will have put user on request
    const user = req.user;
    return this.authService.getProfile(user!);
  }

  // Future: POST logout (token blacklist or just client-side clear for MVP JWT)
}
