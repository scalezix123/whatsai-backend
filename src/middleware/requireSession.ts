import { Request, Response, NextFunction } from "express";
import { getWorkspaceContextFromRequestAuthHeader } from "../supabaseAdmin";

declare global {
  namespace Express {
    interface Request {
      workspaceContext?: any;
    }
  }
}

export const requireSession = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const context = await getWorkspaceContextFromRequestAuthHeader(
      req.headers.authorization,
    );
    if (!context) {
      throw new Error("Session required");
    }
    req.workspaceContext = context;
    next();
  } catch (error) {
    next(error);
  }
};
