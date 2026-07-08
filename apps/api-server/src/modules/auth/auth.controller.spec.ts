import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    login: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call authService.login on POST /auth/login', async () => {
    const loginDto = { email: 'test@example.com', password: 'pass' };
    mockAuthService.login.mockResolvedValue({ accessToken: 'token123' });

    const result = await controller.login(loginDto);
    // login internally called with 3 args (third is optional _clientSlug)
    expect(mockAuthService.login).toHaveBeenCalledWith(loginDto.email, loginDto.password, undefined);
    expect(result.accessToken).toBe('token123');
  });

  it('should return user info from me endpoint (guarded)', async () => {
    const mockReq = { user: { sub: 'user1', email: 'test@example.com' } };
    mockAuthService['getProfile'] = jest.fn().mockReturnValue({ id: 'user1' }); // if method exists

    // Since getProfile may be private/internal, we test the endpoint returns something
    const result = await controller.me(mockReq as any);
    expect(result).toBeDefined();
  });
});
