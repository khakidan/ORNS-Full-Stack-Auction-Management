import express from "express";
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
import createAppsScriptRouter from './routes/appsScriptRoutes';
import createBugReportRouter from './routes/bugReportRoutes';
import createSchedulerRouter from './routes/schedulerRoutes';
import createVolunteerAuthRouter from './routes/volunteerAuthRoutes';

// Middleware
import { errorHandler } from './middleware/errorHandler';
import { cacheControl } from './middleware/cacheControl';
import { createSecurityHeaders } from './middleware/securityHeaders';

declare global {
  namespace Express {
    interface Request {
      session: {
        tokens?: import('../src/types').GoogleTokens;
        /** The signed-in staff member's @orns.org address, set by /auth/callback. */
        email?: string;
        /** One-time OAuth `state`, set by /auth/url and consumed by /auth/callback. */
        oauthState?: string;
        /** Set when the OAuth flow is connecting the shared volunteer account, not signing someone in. */
        oauthPurpose?: "volunteer-account";
        /** A volunteer's session (no Google tokens of their own). */
        volunteer?: { id: string; email: string };
      } | null;
      /** Who is asking - set by requireAuth. */
      user?: {
        email: string;
        role: import('./utils/permissions').UserRole;
        capabilities: import('./utils/permissions').Capability[];
        /** Set for volunteers. */
        volunteerId?: string;
      };
      /** For volunteers: the shared volunteer account's Google client, set by requireAuth. */
      googleAuth?: import('google-auth-library').OAuth2Client;
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

// No CORS middleware: the React app is served by this same Express
// server (Vite middleware locally, dist/ on Cloud Run), so every API call
// is same-origin. Without CORS headers, browsers won't let any other
// site read these responses or send the JSON requests the API expects.

// Middleware
// Default express.json() body limit is 100kb - too small for the bug
// report tool's base64-encoded screenshot payload (a real, ordinary
// screenshot comfortably exceeds that; hit in practice, not a
// hypothetical). 5mb covers a realistic full-page PNG screenshot with
// real headroom while still bounding worst-case request size.
app.use(express.json({ limit: "5mb" }));

// Global middleware to prevent caching
app.use(cacheControl);

// Cloud Run terminates TLS at Google's front end and forwards plain HTTP;
// trusting that one proxy hop is what lets Express (and cookie-session's
// `secure` option below) see the original request as HTTPS.
app.set("trust proxy", 1);

// Secure (HTTPS-only) cookies in the deployed production build. Off for
// `npm run dev`, tests, and a local `npm start` against
// http://localhost, where a secure cookie would never be stored.
const isLocalhost = !process.env.APP_URL || process.env.APP_URL.includes("localhost");
const secureCookies = process.env.NODE_ENV === "production" && !isLocalhost;

// Before every route and before boot.ts's static/Vite handlers, so pages
// and assets get them too.
app.use(createSecurityHeaders({ hsts: secureCookies }));

app.use(
  cookieSession({
    name: "orns_session",
    keys: [process.env.SESSION_SECRET],
    secure: secureCookies,
    sameSite: "lax",
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  })
);

// Setup Base Routes (Mounting everything cleanly)
app.use("/api/health", healthRouter);
app.use(authRoutes);
app.use(createVolunteerAuthRouter());
app.use("/api/receipts", createReceiptsRouter());
app.use("/api/auction", createSetupRouter());
app.use("/api/production", createProductionRouter());
app.use("/api/apps-script", createAppsScriptRouter());
app.use("/api/bundle", createBundleRouter());
// Mounted before the generic "/api"-prefixed, requireAuth-gated routers
// below - bidRoutes.ts/dataRoutes.ts's `router.use(requireAuth)` matches
// any "/api/..." path as a prefix (the same masking risk documented in
// requireAuth.integration.test.ts), so registering this router first is
// what actually lets its own routes stay reachable without a session.
app.use("/api/bug-reports", createBugReportRouter());
// Cloud Scheduler (no session - its own shared-secret check).
app.use("/internal", createSchedulerRouter());
app.use("/api", createBidRouter());
app.use("/api", createDataRouter());

// Register errorHandler last, after all routes
app.use(errorHandler);

export { app };
