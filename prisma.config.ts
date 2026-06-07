import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { defineConfig, env } from "@prisma/config";

config();

// Get file-relative directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Environment variables are loaded by the runtime/host

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
