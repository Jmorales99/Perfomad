import { UsersRepository } from "../../domain/repositories/UsersRepository";

interface LoginUserInput {
  email: string;
  password: string;
}

export class LoginUser {
  constructor(private usersRepository: UsersRepository) {}

  async execute({ email, password }: LoginUserInput) {
    if (!email || !password) throw new Error("Email y contraseña requeridos.");
    return this.usersRepository.loginUser({ email, password });
  }
}
