import { buildServer } from './app/server.js';
import { env } from './config/env.js';

const app = buildServer();

app.listen({ port: env.PORT, host: '0.0.0.0' })
  .then(() => {
    console.log(`✅ PERFOMAD API running on http://localhost:${env.PORT}`);
    console.log(`📘 Swagger docs: http://localhost:${env.PORT}/docs`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
