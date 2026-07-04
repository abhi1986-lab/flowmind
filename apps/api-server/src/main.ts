import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Trust proxy for accurate IPs if behind LB later (MVP docker/local ok)
  // app.set may vary by adapter; skipped for foundation to avoid type friction.

  // Global validation (class-validator + transform)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Request ID for traceability + audit (must be early)
  app.use(RequestIdMiddleware);

  // Dev CORS (desktop + next.js dashboard)
  // Allow broader origins for desktop renderer (data: URLs send Origin: null) and dev
  app.enableCors({
    origin: (origin, callback) => {
      if (process.env.ALLOW_DEV_CLIENT_HEADER === 'true' || !origin || origin.includes('localhost') || origin === 'null' || origin === undefined) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Client-Id',
      'X-Request-Id',
    ],
  });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port);
  console.log(`FlowMind API listening on http://localhost:${port}`);
}
void bootstrap();
