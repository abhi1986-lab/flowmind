// Prisma 7 config — CLIENT DATA PLANE only.
// Never point this at CONTROL_DATABASE_URL.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/client/schema.prisma",
  migrations: {
    path: "prisma/client/migrations",
  },
  datasource: {
    url: process.env["CLIENT_DATABASE_URL"] || "",
  },
});
