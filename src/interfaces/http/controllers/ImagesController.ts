import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { SupabaseImagesRepository } from "@/infrastructure/repositories/SupabaseImagesRepository"
import { UploadImage } from "@/application/usecases/images/UploadImage"
import { ListImages } from "@/application/usecases/images/ListImages"
import { DeleteImage } from "@/application/usecases/images/DeleteImage"

const repo = new SupabaseImagesRepository()

export async function ImagesController(app: FastifyInstance) {
  // ✅ Generar URL de subida
  app.post("/images/upload-url", async (req, reply) => {
    const user = await verifyUser(req, reply)
    const { filename } = req.body as { filename: string }
    const usecase = new UploadImage(repo)
    const result = await usecase.execute(user.id, filename)
    return reply.send(result)
  })

  // ✅ Listar imágenes
  app.get("/images", async (req, reply) => {
    const user = await verifyUser(req, reply)
    const usecase = new ListImages(repo)
    const images = await usecase.execute(user.id)
    return reply.send(images)
  })

  // ✅ Eliminar imagen
  app.delete("/images/:filename", async (req, reply) => {
    const user = await verifyUser(req, reply)
    const { filename } = req.params as { filename: string }
    const usecase = new DeleteImage(repo)
    await usecase.execute(user.id, filename)
    return reply.send({ success: true })
  })
}
