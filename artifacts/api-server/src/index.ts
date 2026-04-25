import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./dbMigrate";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

runMigrations()
  .then(() => {
    app.listen(port, () => {
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err: err.message }, "DB migration failed, starting anyway");
    app.listen(port, () => {
      logger.info({ port }, "Server listening");
    });
  });
