import "dotenv/config";
import express from "express";
import { createApp } from "./bootstrap";
import { initializeQueues, shutdownQueues } from "./queue";
import { prisma } from "./prisma";
import { ensureSession } from "./state";
import { startCampaignScheduler, stopCampaignScheduler } from "./modules/campaigns/campaigns.scheduler";

const port = Number(process.env.PORT || 3001);
const startupRetryDelaysMs = [1000, 2000, 5000, 10000];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientDatabaseStartupError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const code = "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);

  return (
    code === "EAI_AGAIN" ||
    code === "P1001" ||
    // P1017: pooled Postgres (e.g. Prisma Data Proxy) closes the connection on a
    // cold first transaction. Reconnecting on retry succeeds, so treat as transient.
    code === "P1017" ||
    message.includes("EAI_AGAIN") ||
    message.includes("Can't reach database server") ||
    message.includes("Server has closed the connection") ||
    message.includes("ConnectionClosed") ||
    message.includes("Temporary failure in name resolution")
  );
}

async function ensureSessionWithRetry() {
  let lastError: unknown;

  for (let attempt = 0; attempt <= startupRetryDelaysMs.length; attempt += 1) {
    try {
      return await ensureSession(prisma);
    } catch (error) {
      lastError = error;

      if (
        !isTransientDatabaseStartupError(error) ||
        attempt === startupRetryDelaysMs.length
      ) {
        throw error;
      }

      const delayMs = startupRetryDelaysMs[attempt];
      console.warn(
        `Database not reachable during startup (attempt ${attempt + 1}/${startupRetryDelaysMs.length + 1}). Retrying in ${delayMs}ms...`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function start() {
  try {
    // Ensure database is ready
    await ensureSessionWithRetry();

    // Create the app with all modular routes
    const app = await createApp();

    // Initialize job queues
    await initializeQueues();

    // Start the server
    const server = app.listen(port, () => {
      console.log(`WaBiz API listening on http://localhost:${port}`);
    });

    // Fire due scheduled campaigns on an in-process polling loop.
    startCampaignScheduler(prisma);

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      console.log("SIGTERM received, gracefully shutting down...");
      stopCampaignScheduler();
      await shutdownQueues();
      server.close(() => {
        console.log("Server closed");
        process.exit(0);
      });
    });

    process.on("SIGINT", async () => {
      console.log("SIGINT received, gracefully shutting down...");
      stopCampaignScheduler();
      await shutdownQueues();
      server.close(() => {
        console.log("Server closed");
        process.exit(0);
      });
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

start();

export default express();
