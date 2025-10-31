import type { FastifyInstance } from 'fastify'
import { ProfileController } from '@/interfaces/http/controllers/ProfileController'

export async function userRoutes(app: FastifyInstance) {
  await app.register(ProfileController, { prefix: '/users' })
}
