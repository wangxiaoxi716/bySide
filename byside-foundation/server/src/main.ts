import 'reflect-metadata';
import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule, Store, ModelService } from './modules';
import { json } from 'express';
import type { Request, Response } from 'express';
import { join } from 'path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { attachSpeechSocket } from './speech';
import { ApiErrorFilter } from './api-error';
import { createRealtimeServer } from './realtime';

const root = join(__dirname, '../..');
config({ path: join(root, '.env') });
process.chdir(root);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.use((req: Request, res: Response, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host)) { res.status(403).json({ message: '只允许本机访问' }); return; }
    if (req.headers.origin && req.headers.origin !== `http://${host}`) { res.status(403).json({ message: '请求来源不允许' }); return; }
    // Extension credentials are only accepted on permission-checked extension routes.
    if (req.headers.authorization && !((req.method === 'GET' && /^\/api\/v1\/extensions\/[^/]+\/(snapshot|stream)$/.test(req.path)) || (req.method === 'POST' && /^\/api\/v1\/extensions\/[^/]+\/(events|respond)$/.test(req.path)))) { res.status(403).json({ statusCode: 403, message: '扩展令牌不能调用此接口', error: 'Forbidden' }); return; }
    next();
  });
  app.use(json({ limit: '3mb' }));
  app.use((req: Request, res: Response, next: () => void) => {
    const bodylessCancel = req.method === 'POST' && /^\/api\/v1\/(chat|vision)\/[^/]+\/cancel$/.test(req.path) && req.body === undefined;
    if (!bodylessCancel && req.path.startsWith('/api/v1/') && ['POST', 'PATCH'].includes(req.method) && (req.body === null || Array.isArray(req.body) || typeof req.body !== 'object')) { res.status(400).json({ statusCode: 400, message: '请求体必须是 JSON 对象', error: 'Bad Request' }); return; }
    next();
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiErrorFilter());
  app.use('/foundation', (_req: Request, res: Response) => res.sendFile(join(process.cwd(), 'web/dist/index.html')));
  app.useStaticAssets(join(process.cwd(), 'original-ui'));
  app.useStaticAssets(join(process.cwd(), 'web/dist'));
  app.useStaticAssets(join(process.cwd(), 'data/uploads'), { prefix: '/uploads/' });
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('bySide 基座 API').setDescription('本机陪伴基座与扩展接口。扩展令牌只适用于标记了权限的扩展接口。').setVersion('1.0').addBearerAuth().build());
  SwaggerModule.setup('api/docs', app, document);
  attachSpeechSocket(app.getHttpServer(), createRealtimeServer(app.get(Store), {
    chat: (messages, signal) => app.get(ModelService).chat(messages, signal, 2200),
    visionChat: (messages, signal) => app.get(ModelService).vision(messages, signal, 2200),
    visionConfigured: () => Boolean(process.env.YATUAN_AI_KEY && process.env.YATUAN_AI_ENDPOINT && (process.env.YATUAN_VISION_MODEL || process.env.YATUAN_AI_MODEL)),
  }));
  await app.listen(Number(process.env.PORT || 4173), process.env.HOST || '127.0.0.1');
  console.log(`bySide 已启动 http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 4173}`);
}
bootstrap();
