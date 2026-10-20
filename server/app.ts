import express from "express";
import cors from "cors";
import cookieSession from "cookie-session";

// Routers
import healthRouter from './routes/health';
import authRoutes from './routes/authRoutes';
import createReceiptsRouter from './routes/receiptRoutes';
import createBundleRouter from './routes/bundleRoutes';
import createSetupRouter from './routes/setupRoutes';
import createBidRouter from './routes/bidRoutes';
import createDataRouter from './routes/dataRoutes';
import createProductionRouter from './routes/productionRoutes';
import createBugReportRouter from './routes/bugReportRoutes';

// Middleware
import { errorHandler } from './middleware/errorHandler';
import { cacheControl } from './middleware/cacheControl';
import { cookiePolicy } from './middleware/cookiePolicy';
import { tokenRestorer } from './middleware/tokenRestorer';

declare global {
  namespace Express {
    interface Request {
      session: { tokens?: import('../src/types').GoogleTokens } | null;
    }
  }
}

// No fallback secret: validateEnv() aborts boot before this module is
// reached in every real entry point, but this module's own import must
// not silently sign cookies with a public, well-known string if that
// guard is ever skipped (a new entry point, a reused test harness) -
// that would let anyone forge a valid orns_session cookie.
if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required.");
}

const app = express();

// This tool runs as a local application (browser + Tauri desktop shell).
// No public deployment exists, so the allowlist covers only localhost
// and the Tauri custom protocol. All other origins are rejected.
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('tauri://') || origin.startsWith('http://localhost')) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-google-tokens']
}));

// Middleware
// Default express.json() body limit is 100kb - too small for the bug
// report tool's base64-encoded screenshot payload (a real, ordinary
// screenshot comfortably exceeds that; hit in practice, not a
// hypothetical). 5mb covers a realistic full-page PNG screenshot with
// real headroom while still bounding worst-case request size.
app.use(express.json({ limit: "5mb" }));

// Global middleware to prevent caching
app.use(cacheControl);

app.set("trust proxy", 1);

app.use(
  cookieSession({
    name: "orns_session",
    keys: [process.env.SESSION_SECRET],
    secure: process.env.NODE_ENV === "production" && !process.env.APP_URL?.includes("localhost"),
    sameSite: (process.env.NODE_ENV === "production" && !process.env.APP_URL?.includes("localhost")) ? "none" : "lax",
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  })
);

// Dynamic cookie settings middleware for proper iframe (AI Studio build site) and top-level tab sameSite settings
app.use(cookiePolicy);

// Restore session tokens if present in client headers, bypassing cookie block restrictions
app.use(tokenRestorer);

// Setup Base Routes (Mounting everything cleanly)
app.use("/api/health", healthRouter);
app.use(authRoutes);
app.use("/api/receipts", createReceiptsRouter());
app.use("/api/auction", createSetupRouter());
app.use("/api/production", createProductionRouter());
app.use("/api/bundle", createBundleRouter());
// Mounted before the generic "/api"-prefixed, requireAuth-gated routers
// below - bidRoutes.ts/dataRoutes.ts's `router.use(requireAuth)` matches
// any "/api/..." path as a prefix (the same masking risk documented in
// requireAuth.integration.test.ts), so registering this router first is
// what actually lets its own routes stay reachable without a session.
app.use("/api/bug-reports", createBugReportRouter());
app.use("/api", createBidRouter());
app.use("/api", createDataRouter());

// Register errorHandler last, after all routes
app.use(errorHandler);

export { app };
