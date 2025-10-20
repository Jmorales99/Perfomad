import type { FastifyInstance } from 'fastify';

export async function helloRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    return { message: 'Hola desde PERFOMAD API 🚀' };
  });
}
