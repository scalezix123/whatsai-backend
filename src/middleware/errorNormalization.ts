import { Request, Response, NextFunction } from "express";

export const errorNormalization = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Internal server error";
  const requestId = req.id || "unknown";

  console.error({
    requestId,
    statusCode,
    message,
    stack: err.stack,
    workspaceId: req.workspaceContext?.workspaceId,
  });

  res.status(statusCode).json({
    error: {
      message,
      requestId,
      ...(err.details !== undefined && { details: err.details }),
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    },
  });
};
