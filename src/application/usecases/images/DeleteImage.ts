import { ImagesRepository } from '@/domain/repositories/ImagesRepository'

export class DeleteImage {
  constructor(private readonly repo: ImagesRepository) {}

  async execute(userId: string, filename: string) {
    if (!filename) throw new Error('Debe especificarse el archivo a eliminar.')
    return await this.repo.deleteImage(userId, filename)
  }
}
