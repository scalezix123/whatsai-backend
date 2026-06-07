import { Request, Response, NextFunction } from "express";

export const requireWorkspace = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.workspaceContext?.workspaceId) {
      throw new Error("Workspace context required");
    }
    next();
  } catch (error) {
    next(error);
  }
};
