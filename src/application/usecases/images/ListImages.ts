import { ImagesRepository } from '@/domain/repositories/ImagesRepository'

export class ListImages {
  constructor(private readonly repo: ImagesRepository) {}

  async execute(userId: string) {
    return await this.repo.listUserImages(userId)
  }
}
