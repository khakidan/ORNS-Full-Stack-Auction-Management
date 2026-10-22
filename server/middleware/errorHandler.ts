import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error("Centralized Error:", err);
  // body-parser (and other middleware) set a real status on the error
  // object (e.g. 413 for a too-large request body) - forcing 500
  // unconditionally hid that behind a misleading "Internal Server
  // Error" status for what's actually a client-side request problem.
  const status = (err as any).status || (err as any).statusCode || 500;
  // `message` can carry Google/PayPal API text, so only signed-in staff
  // get it (ROADMAP.md L6) - they need it: several failures tell them
  // exactly what to fix by hand, e.g. "PayPal invoice ... could not be
  // saved to Bidder-Numbers row 12 ... Enter it there by hand". Anyone
  // else gets just the status, unless the error is one body-parser marks
  // as safe to show (`expose`, e.g. "request entity too large").
  const signedIn = Boolean(req.session?.tokens);
  const showMessage = signedIn || (err as any).expose === true;
  res.status(status).json(showMessage ? { error: "Internal Server Error", message: err.message } : { error: "Internal Server Error" });
}
