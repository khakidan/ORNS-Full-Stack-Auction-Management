import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error("Centralized Error:", err);
  // body-parser (and other middleware) set a real status on the error
  // object (e.g. 413 for a too-large request body) - forcing 500
  // unconditionally hid that behind a misleading "Internal Server
  // Error" status for what's actually a client-side request problem.
  const status = (err as any).status || (err as any).statusCode || 500;
  res.status(status).json({ error: "Internal Server Error", message: err.message });
}
