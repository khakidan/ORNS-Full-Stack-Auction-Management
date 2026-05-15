import express from "express";
import path from "path";
import fs from "fs";
import { google } from "googleapis";
import session from "express-session";
import sessionFileStore from "session-file-store";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import cors from "cors";

const FileStore = sessionFileStore(session);

declare module "express-session" {
  interface SessionData {
    tokens: any;
  }
}

dotenv.config();

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post("/api/ai/suggest-name", async (req, res) => {
  try {
    const { descriptions } = req.body;
    if (!descriptions || !Array.isArray(descriptions) || descriptions.length === 0) {
      return res.status(400).json({ error: "Missing descriptions array" });
    }

    const prompt = `I am putting together a silent auction bundle for a non-profit preschool fundraiser. The bundle includes the following items:\n\n${descriptions.join("\n")}\n\nPlease suggest 3 clever, fun, or catchy names for this bundle. Return ONLY a JSON array of strings containing the 3 names, and nothing else.`;
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    
    const text = response.text || "[]";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json({ names: parsed });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
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
  credentials: true
}));

// Middleware
app.use(express.json());
app.set("trust proxy", 1);
const DATA_DIR = process.env.APP_DATA_DIR || process.cwd();
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

app.use(
  session({
    store: new FileStore({
      path: SESSIONS_DIR,
      retries: 0,
    }),
    secret: process.env.SESSION_SECRET || "auction-pro-secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === "production" && !process.env.APP_URL?.includes("localhost"),
      sameSite: (process.env.NODE_ENV === "production" && !process.env.APP_URL?.includes("localhost")) ? "none" : "lax",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days for local persistence
    },
  })
);

// Scopes for Google Workspace APIs
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.external_request",
  "https://www.googleapis.com/auth/drive"
];

const getOAuthClient = (req?: express.Request) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing from environment. Please check the Secrets panel in AI Studio.");
  }

  // Use the current request host if available, falling back to APP_URL
  // This helps when switching between DEV and PREVIEW URLs in AI Studio
  let baseUrl = "";
  if (req) {
    let protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");

    // Force HTTPS for AI Studio environments which are served behind a proxy
    if (host && (host.includes("run.app") || host.includes("ais-"))) {
      protocol = "https";
    }

    baseUrl = `${protocol}://${host}`;
  } else {
    baseUrl = process.env.APP_URL || "http://localhost:3000";
    // If APP_URL is set but protocol is missing or http for a production host, fix it
    if (baseUrl.includes("run.app") && baseUrl.startsWith("http:")) {
      baseUrl = baseUrl.replace("http:", "https:");
    }
  }

  // Ensure no trailing slash on baseUrl
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  const redirectUri = `${cleanBaseUrl}/auth/callback`;

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

// Auth Routes
app.post("/api/log", (req, res) => {
  console.log(`[CLIENT LOG] ${new Date().toISOString()}:`, JSON.stringify(req.body, null, 2));
  res.status(200).end();
});

app.get("/api/auth/url", (req, res) => {
  try {
    console.log(`[Server] Auth URL request from host: ${req.get("host")}`);
    const client = getOAuthClient(req);
    const url = client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
    });
    console.log(`[Server] Generated Auth URL (starts with): ${url.substring(0, 50)}...`);
    res.json({ url });
  } catch (error: any) {
    console.error("[Server] Error generating Auth URL:", error.message);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const client = getOAuthClient(req);
    const { tokens } = await client.getToken(code as string);
    req.session.tokens = tokens;

    req.session.save((err) => {
      if (err) console.error("Session save error:", err);
      res.send(`
        <html>
          <body>
            <div style="font-family: sans-serif; text-align: center; padding-top: 50px;">
              <h2>Authentication Successful</h2>
              <p>You can close this window now.</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                  setTimeout(() => window.close(), 1000);
                } else {
                  window.location.href = '/';
                }
              </script>
            </div>
          </body>
        </html>
      `);
    });
  } catch (error: any) {
    const errorDetails = error.response?.data || error.message;
    console.error("Error getting tokens during callback:", errorDetails);
    res.status(500).send(`Authentication failed: ${JSON.stringify(errorDetails)}`);
  }
});

app.get("/api/auth/status", (req, res) => {
  res.json({ authenticated: !!req.session.tokens });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.json({ success: true });
  });
});

// Helper to get authenticated client
function getAuthenticatedClient(tokens: any) {
  const client = getOAuthClient();
  client.setCredentials(tokens);
  return client;
}

// Receipt Generation Endpoint
app.post("/api/receipts/generate", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { bidder, emailReceipt, scriptId: bodyScriptId, spreadsheetId } = req.body;
  const scriptId = bodyScriptId || process.env.GOOGLE_SCRIPT_ID;
  
  if (!scriptId) {
    return res.status(500).json({
      error: "GOOGLE_SCRIPT_ID is not configured. Please add it to the Settings tab in the app."
    });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const script = google.script({ version: "v1", auth: client });

    console.log(`[Script API] Calling bridge function 'apiCreateIndividualReceipt' for Bidder ${bidder.id}`);

    const response = await script.scripts.run({
      scriptId: scriptId,
      requestBody: {
        function: "apiCreateIndividualReceipt",
        parameters: spreadsheetId ? [bidder.id, !!emailReceipt, spreadsheetId] : [bidder.id, !!emailReceipt],
        devMode: true, // Uses the latest saved version
      },
    });

    if (response.data.error) {
      const error = response.data.error;
      console.error("[Script API Error]", error);
      return res.status(500).json({
        error: `Apps Script Execution Error: ${error.details?.[0]?.errorMessage || error.message}`
      });
    }

    const result: any = response.data.response?.result;

    if (result && result.success === false) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      documentId: result?.docId,
      total: result?.total
    });

  } catch (error: any) {
    console.error("[Server Error]", error);
    res.status(500).json({
      error: error.message || "Failed to trigger Apps Script. Check Script ID and permissions."
    });
  }
});

// Batch generate all receipts via Apps Script
app.post("/api/receipts/generate-all", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { scriptId: bodyScriptId, spreadsheetId } = req.body;
  const scriptId = bodyScriptId || process.env.GOOGLE_SCRIPT_ID;
  if (!scriptId) return res.status(500).json({ error: "GOOGLE_SCRIPT_ID not configured. Please set it in Settings." });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const script = google.script({ version: "v1", auth: client });

    const response = await script.scripts.run({
      scriptId: scriptId,
      requestBody: {
        function: "apiCreateAllReceipts",
        parameters: spreadsheetId ? [spreadsheetId] : [],
        devMode: true,
      },
    });

    if (response.data.error) throw new Error(response.data.error.message);
    
    const result: any = response.data.response?.result;
    if (result && result.success === false) {
      return res.status(400).json({ error: result.error || "Batch generation failed" });
    }

    res.json({ success: true, result });
  } catch (error: any) {
    console.error("[Server Error] generate-all:", error);
    res.status(500).json({ error: error.message });
  }
});

// Batch send all emails via Apps Script
app.post("/api/receipts/email-all", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { scriptId: bodyScriptId, spreadsheetId } = req.body;
  const scriptId = bodyScriptId || process.env.GOOGLE_SCRIPT_ID;
  if (!scriptId) return res.status(500).json({ error: "GOOGLE_SCRIPT_ID not configured. Please set it in Settings." });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const script = google.script({ version: "v1", auth: client });

    const response = await script.scripts.run({
      scriptId: scriptId,
      requestBody: {
        function: "apiSendAllEmails",
        parameters: spreadsheetId ? [spreadsheetId] : [],
        devMode: true,
      },
    });

    if (response.data.error) throw new Error(response.data.error.message);
    
    const result: any = response.data.response?.result;
    if (result && result.success === false) {
      return res.status(400).json({ error: result.error || "Batch email failed" });
    }

    res.json({ success: true, result });
  } catch (error: any) {
    console.error("[Server Error] email-all:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create walk-in ticket via Apps Script
app.post("/api/bidders/walk-in", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { firstName, lastName, email, scriptId: bodyScriptId, spreadsheetId } = req.body;
  const scriptId = bodyScriptId || process.env.GOOGLE_SCRIPT_ID;
  if (!scriptId) return res.status(500).json({ error: "GOOGLE_SCRIPT_ID not configured. Please set it in Settings." });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const script = google.script({ version: "v1", auth: client });

    const response = await script.scripts.run({
      scriptId: scriptId,
      requestBody: {
        function: "apiCreateWalkInTicket",
        parameters: spreadsheetId ? [firstName, lastName, email, spreadsheetId] : [firstName, lastName, email],
        devMode: true,
      },
    });

    if (response.data.error) {
      throw new Error(response.data.error.details?.[0]?.errorMessage || response.data.error.message);
    }

    const result: any = response.data.response?.result;
    if (result && result.success === false) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Dedicated endpoint to resend an email receipt via Apps Script
app.post("/api/receipts/email-only", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { bidderId, scriptId: bodyScriptId, spreadsheetId } = req.body;
  const scriptId = bodyScriptId || process.env.GOOGLE_SCRIPT_ID;
  if (!scriptId) return res.status(500).json({ error: "GOOGLE_SCRIPT_ID not configured. Please set it in Settings." });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const script = google.script({ version: "v1", auth: client });

    const response = await script.scripts.run({
      scriptId: scriptId,
      requestBody: {
        function: "apiSendReceiptEmail",
        parameters: spreadsheetId ? [bidderId, spreadsheetId] : [bidderId],
        devMode: true,
      },
    });

    if (response.data.error) throw new Error(response.data.error.message);
    
    const result: any = response.data.response?.result;
    if (result && result.success === false) {
      return res.status(400).json({ error: result.error || "Email sending failed" });
    }

    res.json({ success: true, result });
  } catch (error: any) {
    console.error("[Server Error] email-only:", error);
    res.status(500).json({ error: error.message });
  }
});

// Generic endpoint to run any Apps Script function
app.post("/api/script/run", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { functionName, parameters, scriptId: bodyScriptId } = req.body;
  const scriptId = bodyScriptId || process.env.GOOGLE_SCRIPT_ID;
  
  if (!scriptId) {
    return res.status(500).json({
      error: "GOOGLE_SCRIPT_ID is not configured. Please add it to the Settings tab in the app."
    });
  }
  if (!functionName) {
    return res.status(400).json({ error: "functionName is required" });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const script = google.script({ version: "v1", auth: client });

    console.log(`[Script API] Calling bridge function '${functionName}'`);

    const response = await script.scripts.run({
      scriptId: scriptId,
      requestBody: {
        function: functionName,
        parameters: parameters || [],
        devMode: true,
      },
    });

    if (response.data.error) {
      const error = response.data.error;
      console.error("[Script API Error]", error);
      return res.status(500).json({
        error: `Apps Script Execution Error: ${error.details?.[0]?.errorMessage || error.message}`
      });
    }

    const result: any = response.data.response?.result;

    if (result && result.success === false) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      result: result
    });

  } catch (error: any) {
    console.error("[Server Error]", error);
    res.status(500).json({
      error: error.message || "Failed to trigger Apps Script. Check Script ID and permissions."
    });
  }
});
app.post("/api/settings/update", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { spreadsheetId, key, value, description } = req.body;
  if (!spreadsheetId || !key) return res.status(400).json({ error: "Missing required fields" });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    // 1. Get all settings
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "_Settings!A:C",
    });

    const rows = result.data.values || [];
    let rowIndex = -1;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === key) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex !== -1) {
      // 2. Update existing
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `_Settings!B${rowIndex}:C${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[value, description || rows[rowIndex - 1][2] || ""]],
        },
      });
    } else {
      // 3. Append new
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "_Settings!A:C",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[key, value, description || ""]],
        },
      });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error updating setting:", error);
    res.status(500).json({ error: error.message });
  }
});

// Sheet API Proxy
app.get("/api/sheets/:spreadsheetId/:range", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: req.params.spreadsheetId,
      range: req.params.range,
    });
    res.json(result.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sheets/:spreadsheetId/:range", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.values.update({
      spreadsheetId: req.params.spreadsheetId,
      range: req.params.range,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: req.body.values,
      },
    });
    res.json(result.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sheets/:spreadsheetId/:range/append", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: req.params.spreadsheetId,
      range: req.params.range,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: req.body.values,
      },
    });
    res.json(result.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/sheets/:spreadsheetId/metadata", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.get({
      spreadsheetId: req.params.spreadsheetId,
    });
    res.json(result.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sheets/:spreadsheetId/batchUpdate", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: req.params.spreadsheetId,
      requestBody: req.body,
    });
    res.json(result.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Drive API Proxy
app.get("/api/drive/files/:folderId", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const drive = google.drive({ version: "v3", auth: client });

    // check scopes
    console.log(`[Drive API] Cached Scopes: ${req.session.tokens.scope}`);
    
    console.log(`[Drive API] Fetching files for folderId: ${req.params.folderId}`);
    const query = `'${req.params.folderId}' in parents and trashed = false`;
    console.log(`[Drive API] Query: ${query}`);

    const result = await drive.files.list({
      q: query,
      fields: "files(id, name, webViewLink, iconLink, modifiedTime)",
      orderBy: "modifiedTime desc",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
    });
    
    console.log(`[Drive API] Found ${result.data.files?.length || 0} files`);
    if (result.data.files && result.data.files.length > 0) {
      result.data.files.forEach(f => console.log(`[Drive API] File: ${f.name} - ID: ${f.id} - Link: ${f.webViewLink}`));
    }
    res.json(result.data.files || []);
  } catch (error: any) {
    console.error(`[Drive API] Error fetching files:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/drive/download/:fileId", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const drive = google.drive({ version: "v3", auth: client });
    const fileId = req.params.fileId;

    // Get metadata to determine if it's a Google Doc or a regular file (like PDF)
    const metadata = await drive.files.get({ 
      fileId, 
      fields: "id, name, mimeType",
      supportsAllDrives: true
    });
    
    const fileName = metadata.data.name || "receipt";
    const mimeType = metadata.data.mimeType;

    console.log(`[Drive API] Downloading ${fileId} (${fileName}) - MimeType: ${mimeType}`);

    if (mimeType === "application/vnd.google-apps.document") {
      // It's still a Google Doc, so we must export it
      console.log(`[Drive API] Exporting Workspace doc as PDF`);
      const response = await drive.files.export(
        { 
          fileId, 
          mimeType: "application/pdf" 
        },
        { responseType: "stream" }
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}.pdf"`);
      response.data.pipe(res);
    } else {
      // It's a regular file (like the new PDFs), get it directly
      console.log(`[Drive API] Fetching binary content`);
      const response = await drive.files.get(
        { 
          fileId, 
          alt: "media",
          supportsAllDrives: true 
        },
        { responseType: "stream" }
      );
      
      res.setHeader("Content-Type", mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      response.data.pipe(res);
    }

    console.log(`[Drive API] Download started for ${fileId}`);
  } catch (error: any) {
    console.error(`[Drive API] Download failure:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Vite Middleware
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
