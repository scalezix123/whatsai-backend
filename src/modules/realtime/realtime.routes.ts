import { Router } from "express";
import { prisma } from "../../prisma";
import { requireSession } from "../../middleware";

const router = Router();

const clients = new Map<string, Set<import("express").Response>>();

export function broadcastToWorkspace(workspaceId: string, event: string, data: unknown) {
  const workspaceClients = clients.get(workspaceId);
  if (!workspaceClients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of workspaceClients) {
    res.write(payload);
  }
}

router.get("/stream", requireSession, (req, res) => {
  const workspaceId = req.workspaceContext.workspaceId;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ workspaceId })}\n\n`);

  if (!clients.has(workspaceId)) {
    clients.set(workspaceId, new Set());
  }
  clients.get(workspaceId)!.add(res);

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.get(workspaceId)?.delete(res);
    if (clients.get(workspaceId)?.size === 0) {
      clients.delete(workspaceId);
    }
  });
});

export default router;
