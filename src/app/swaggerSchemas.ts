// src/app/swaggerSchemas.ts

export const swaggerSchemas = {
  AuthSignupBody: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'user@example.com' },
      password: { type: 'string', minLength: 6, example: '123456' },
    },
  },
  AuthSignupResponse: {
    type: 'object',
    properties: {
      message: { type: 'string', example: 'Usuario registrado correctamente' },
      user: { type: 'object' },
    },
  },
  AuthLoginBody: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'user@example.com' },
      password: { type: 'string', example: '123456' },
    },
  },
  AuthLoginResponse: {
    type: 'object',
    properties: {
      message: { type: 'string', example: 'Inicio de sesión exitoso' },
      access_token: { type: 'string', example: 'jwt.token.aqui' },
      user: { type: 'object' },
    },
  },
  ErrorResponse: {
    type: 'object',
    properties: {
      error: { type: 'string', example: 'Mensaje de error' },
    },
  },
};
