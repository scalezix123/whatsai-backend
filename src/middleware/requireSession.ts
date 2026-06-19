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
      const err: any = new Error("Session required");
      err.statusCode = 401;
      throw err;
    }
    req.workspaceContext = context;
    next();
  } catch (error) {
    next(error);
  }
};
