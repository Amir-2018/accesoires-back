import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";

dotenv.config({ path: ["prisma/.env", ".env"] });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
