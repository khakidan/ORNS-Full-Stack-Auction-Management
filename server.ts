import express from "express";
import path from "path";
import fs from "fs";
import cookieSession from "cookie-session";

import "./server/services/google";

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import cors from "cors";

// Routers
import healthRouter from './server/routes/health';
import authRoutes from './server/routes/authRoutes';
import createReceiptsRouter from './server/routes/receiptRoutes';
import createBundleRouter from './server/routes/bundleRoutes';
import createSetupRouter from './server/routes/setupRoutes';
import createBidRouter from './server/routes/bidRoutes';
import createDataRouter from './server/routes/dataRoutes';
import createProductionRouter from './server/routes/productionRoutes';

import { errorHandler } from './server/middleware/errorHandler';
import { cacheControl } from './server/middleware/cacheControl';
import { cookiePolicy } from './server/middleware/cookiePolicy';
import { tokenRestorer } from './server/middleware/tokenRestorer';

declare global {
  namespace Express {
    interface Request {
      session: { tokens?: any } | null;
    }
  }
}

dotenv.config();

const app = express();
const PORT = 3000;

// CORS configuration to allow Tauri app to talk to local server
app.use(cors({
  origin: (origin, callback) => {
    // Allow null origin (some local requests), tauri custom protocols, and localhost
    if (!origin || origin.startsWith('tauri://') || origin.startsWith('http://localhost')) {
      callback(null, true);
    } else {
      callback(null, true); // Be permissive for local development for now
    }
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-google-tokens']
}));

// Middleware
app.use(express.json());

// Global middleware to prevent caching (required for Firebase Hosting to preserve Set-Cookie)
app.use(cacheControl);

app.set("trust proxy", 1);

app.use(
  cookieSession({
    name: "__session", // Required for Firebase Hosting
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

// Environment strict validation on boot
const requiredEnvVars = [
  "SESSION_SECRET",
  "GEMINI_API_KEY",
  "SCRIPT_ID_BID_MANAGEMENT",
  "SCRIPT_ID_ITEM_ENTRY",
  "SCRIPT_ID_TICKETS"
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`\n[FATAL SYSTEM ERROR] Boot aborted. Missing required environment variable: ${envVar}\n`);
    process.exit(1);
  }
}

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, the dist folder should be next to the executable or in a known location.
    // For Tauri apps, the frontend is served by Tauri itself, so this is mainly a fallback.
    // Use __dirname for CJS bundles
    let currentDir: string;
    try {
      currentDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
    } catch (e) {
      currentDir = process.cwd();
    }

    // Try a few fallback locations for the static dist folder
    let distPath = process.env.DIST_PATH || "";
    
    if (!distPath) {
      const searchPaths = [
        path.join(currentDir, "dist"),
        path.join(currentDir, "..", "dist"),
        path.join(process.cwd(), "dist")
      ];
      
      for (const p of searchPaths) {
        if (fs.existsSync(path.join(p, "index.html"))) {
          distPath = p;
          break;
        }
      }
      
      // Default fallback
      if (!distPath) distPath = path.join(currentDir, "dist");
    }

    console.log(`[Server] Serving static files from: ${distPath}`);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      res.sendFile(indexPath);
    });
  }

  // Bind structured centralized error handler
  app.use(errorHandler);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
