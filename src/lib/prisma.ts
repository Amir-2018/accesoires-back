import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ["prisma/.env", ".env"] });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
