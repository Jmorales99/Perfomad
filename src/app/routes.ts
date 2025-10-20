import type { FastifyInstance } from 'fastify';
import { helloRoutes } from '../interfaces/http/controllers/HelloController.js';
import { widgetRoutes } from '../interfaces/http/controllers/WidgetController.js';

export async function routes(app: FastifyInstance) {
  await app.register(helloRoutes, { prefix: '/hello' });
  await app.register(widgetRoutes, { prefix: '/widgets' });
}
