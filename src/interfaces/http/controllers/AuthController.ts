import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { SupabaseUserRepository } from "../../../infrastructure/repositories/SupabaseUserRepository.js"
import { RegisterUser } from "../../../application/usecases/RegisterUser.js"
import { LoginUser } from "../../../application/usecases/LoginUser.js"

export class AuthController {
  private registerUser: RegisterUser
  private loginUser: LoginUser

  constructor(private app: FastifyInstance) {
    const repository = new SupabaseUserRepository()
    this.registerUser = new RegisterUser(repository)
    this.loginUser = new LoginUser(repository)
  }

  signup = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { email, password, name, age, phone } = req.body as any;
      const result = await this.registerUser.execute({ email, password, name, age, phone });
      return reply.code(201).send(result);
    } catch (error: any) {
      this.app.log.error(error);
      return reply.code(400).send({ error: error.message });
    }
  };

  login = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { email, password } = req.body as any
      const result = await this.loginUser.execute({ email, password })
      return reply.send(result)
    } catch (error: any) {
      this.app.log.error(error)
      return reply.code(401).send({ error: error.message })
    }
  }
}
