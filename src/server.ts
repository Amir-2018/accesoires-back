import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";

const server = app.listen(config.port, () => {
  console.log(`ZEN backend démarré sur http://localhost:${config.port}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
