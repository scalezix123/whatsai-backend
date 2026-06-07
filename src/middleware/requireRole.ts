import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";

export const requireRole = (allowedRoles: UserRole[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.workspaceContext) {
        throw new Error("Session required");
      }

      const userRole: UserRole = req.workspaceContext.role;
      
      if (!allowedRoles.includes(userRole)) {
        throw new Error("Insufficient permissions");
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
