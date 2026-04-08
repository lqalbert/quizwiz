import app from './app.js';
import { config } from './config.js';
import { healthCheckDb } from './db.js';
import { bootstrapAdminIfNeeded } from './bootstrapAdmin.js';

async function bootstrap() {
  try {
    await healthCheckDb();
    await bootstrapAdminIfNeeded();
    app.listen(config.port, () => {
      // eslint-disable-next-line no-console
      console.log(`QuizWiz backend listening on :${config.port}`);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to start backend:', error.message);
    process.exit(1);
  }
}

bootstrap();
