import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";

export const requireRole = (allowedRoles: UserRole[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.workspaceContext) {
        const err: any = new Error("Session required");
        err.statusCode = 401;
        throw err;
      }

      const userRole: UserRole = req.workspaceContext.role;

      if (!allowedRoles.includes(userRole)) {
        const err: any = new Error("Insufficient permissions");
        err.statusCode = 403;
        throw err;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
