import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { routes } from './routes.js';

export function buildServer() {
  const app = Fastify({ logger: true });

  // Seguridad y CORS
  app.register(cors, { origin: true });
  app.register(helmet);

  // Documentación Swagger
  app.register(swagger, {
    openapi: {
      info: {
        title: 'PERFOMAD API',
        description: 'API REST de PERFOMAD',
        version: '1.0.0'
      }
    }
  });
  app.register(swaggerUi, {
    routePrefix: '/docs',
    staticCSP: true
  });

  // Registrar rutas
  app.register(routes, { prefix: '/v1' });

  return app;
}
