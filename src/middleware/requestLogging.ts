import { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma";

export function requestLogging() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const requestId = req.headers["x-request-id"] as string || "unknown";

    res.on("finish", async () => {
      const duration = Date.now() - startTime;
      const workspaceId = req.workspaceContext?.workspaceId;

      if (workspaceId && !req.path.includes("/realtime") && !req.path.includes("/health")) {
        try {
          await prisma.operationalLog.create({
            data: {
              workspaceId,
              eventType: "api_request",
              level: res.statusCode >= 400 ? "error" : "info",
              summary: `${req.method} ${req.path} ${res.statusCode} ${duration}ms`,
              payload: {
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                duration,
                requestId,
                userAgent: req.headers["user-agent"],
                ip: req.ip,
              },
            },
          });
        } catch {
          // Don't fail requests due to logging errors
        }
      }
    });

    next();
  };
}
