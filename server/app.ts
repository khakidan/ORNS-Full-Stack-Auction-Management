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
app.use(express.json());

// Global middleware to prevent caching
app.use(cacheControl);

app.set("trust proxy", 1);

app.use(
  cookieSession({
    name: "orns_session",
    keys: [process.env.SESSION_SECRET || "auction-pro-secret"],
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
app.use("/api", createBidRouter());
app.use("/api", createDataRouter());

// Register errorHandler last, after all routes
app.use(errorHandler);

export { app };
