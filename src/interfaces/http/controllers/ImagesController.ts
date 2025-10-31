import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SupabaseImagesRepository } from '@/infrastructure/repositories/SupabaseImagesRepository'
import { UploadImage } from '@/application/usecases/images/UploadImage'
import { ListImages } from '@/application/usecases/images/ListImages'
import { DeleteImage } from '@/application/usecases/images/DeleteImage'

const repo = new SupabaseImagesRepository()

export async function ImagesController(app: FastifyInstance) {
  // ✅ Generar URL de subida
  app.post('/images/upload-url', { preHandler: [app.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.user.id
      const { filename } = req.body as { filename: string }
      const usecase = new UploadImage(repo)
      const result = await usecase.execute(userId, filename)
      return reply.send(result)
    } catch (error) {
      return reply.status(500).send({ error: (error as Error).message })
    }
  })

  // ✅ Listar imágenes del usuario
  app.get('/images', { preHandler: [app.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.user.id
      const usecase = new ListImages(repo)
      const images = await usecase.execute(userId)
      return reply.send(images)
    } catch (error) {
      return reply.status(500).send({ error: (error as Error).message })
    }
  })

  // ✅ Eliminar imagen
  app.delete('/images/:filename', { preHandler: [app.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = req.user.id
      const { filename } = req.params as { filename: string }
      const usecase = new DeleteImage(repo)
      await usecase.execute(userId, filename)
      return reply.send({ success: true })
    } catch (error) {
      return reply.status(500).send({ error: (error as Error).message })
    }
  })
}
