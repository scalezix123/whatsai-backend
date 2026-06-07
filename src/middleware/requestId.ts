import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export const requestId = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Use provided request ID or generate a new one
    req.id = (req.headers["x-request-id"] as string) || randomUUID();
    
    // Add to response headers for client correlation
    res.setHeader("x-request-id", req.id);
    
    next();
  };
};
