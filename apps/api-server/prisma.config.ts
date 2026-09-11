// Prisma 7 config — CONTROL PLANE only.
// Client data plane uses prisma.client.config.ts + prisma/client/schema.prisma.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/control/schema.prisma",
  migrations: {
    path: "prisma/control/migrations",
  },
  datasource: {
    url:
      process.env["DATABASE_URL"] ||
      process.env["CONTROL_DATABASE_URL"] ||
      "",
  },
});
