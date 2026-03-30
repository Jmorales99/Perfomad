// src/app/server.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { routes } from './routes.js';
import authPlugin from './plugins/authPlugin.js';
import { swaggerSchemas } from './swaggerSchemas.js';
import { authRoutes } from './routes/authRoutes.js';
import { env } from '../config/env.js';

export function buildServer() {
  const app = Fastify({ logger: true });

  // 🌐 Seguridad y CORS
  // 🌐 Seguridad y CORS — configuración completa
  app.register(cors, {
    origin: env.FRONTEND_URL ? [env.FRONTEND_URL] : ["http://localhost:5173"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // ✅ incluir DELETE y OPTIONS
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, // si usas cookies o JWT
  });

  app.register(helmet);

  // 🚦 Rate limiting — cap at 100 requests/minute per IP to prevent abuse
  app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // 🧾 Registrar schemas globales
  Object.entries(swaggerSchemas).forEach(([name, schema]) => {
    app.addSchema({ $id: name, ...schema });
  });

  // 📘 Swagger
  app.register(swagger as any, {
    openapi: {
      info: {
        title: 'PERFOMAD API',
        description: 'API REST de PERFOMAD',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  app.register(swaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
  });

  // 🔐 Plugin que valida JWT
  app.register(authPlugin);

  // ⚙️ Rutas
  app.after(() => {
    // 🧩 Rutas de autenticación (públicas)
    app.register(authRoutes, { prefix: '/v1/auth' });

    // 📦 Rutas del dominio (requieren autenticación)
    app.register(routes, { prefix: '/v1' });

    // 🏠 Health check
    app.get('/', async () => ({ message: 'Welcome to PERFOMAD API 🚀' }));
  });

    app.setErrorHandler((error, req, reply) => {
    // Si el error proviene de la validación del schema
    if ((error as any).validation) {
      const validation = (error as any).validation;

      // Construimos un mensaje legible
      const details = validation
        .map((v: any) => {
          const field =
            v.instancePath?.replace('/', '') || v.params?.missingProperty;
          return field
            ? `Campo '${field}' es inválido o faltante`
            : v.message || 'Error de validación';
        })
        .filter(Boolean)
        .join(', ');

      return reply.code(400).send({ error: details || 'Datos inválidos.' });
    }

    // Si el error no es de validación, registrarlo y responder
    req.log.error(error);
    return reply.code(500).send({ error: 'Error interno del servidor.' });
  });

  return app;
}
