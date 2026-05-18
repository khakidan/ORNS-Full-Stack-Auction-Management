import express from "express";
import path from "path";
import fs from "fs";
import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";
import session from "express-session";

// Global resilient retry matrix for API calls (Exponential backoff & jitter is handled by gaxios internally)
google.options({
  retryConfig: {
    retry: 4,
    retryDelay: 1000,
    httpMethodsToRetry: ['GET', 'PUT', 'HEAD', 'OPTIONS', 'DELETE', 'POST', 'PATCH'],
    statusCodesToRetry: [[100, 199], [429, 429], [500, 599]],
  }
});
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

const app = express();
const PORT = 3000;

// Gemini AI setup
const genAI = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

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
    name: "__session", // Required for Firebase Hosting
    store: new FileStore({
      path: SESSIONS_DIR,
      retries: 0,
    }),
    secret: process.env.SESSION_SECRET || "auction-pro-secret",
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === "production" && !process.env.APP_URL?.includes("localhost"),
      sameSite: (process.env.NODE_ENV === "production" && !process.env.APP_URL?.includes("localhost")) ? "none" : "lax",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    },
    rolling: true,
    resave: true,
  })
);

// Scopes for Google Workspace APIs
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.external_request",
  "openid",
  "https://www.googleapis.com/auth/userinfo.email"
];

const getOAuthClient = (req?: express.Request) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing from environment. Please check the Secrets panel in AI Studio.");
  }

  let baseUrl = "";
  if (req) {
    let protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");

    if (host && (host.includes("run.app") || host.includes("ais-") || host.includes("aistudio") || host.includes("orns.org"))) {
      protocol = "https";
    }

    baseUrl = `${protocol}://${host}`;
  } else {
    baseUrl = process.env.APP_URL || "http://localhost:3000";
    if ((baseUrl.includes("run.app") || baseUrl.includes("ais-") || baseUrl.includes("orns.org")) && baseUrl.startsWith("http:")) {
      baseUrl = baseUrl.replace("http:", "https:");
    }
  }

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
      prompt: "select_account consent",
      hd: "orns.org",
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
    client.setCredentials(tokens);

    // Verify user domain
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email || "";

    if (!email.endsWith("@orns.org")) {
      console.warn(`[Auth] User ${email} rejected: Not an orns.org account`);
      return res.status(403).send(`
        <html>
          <body style="background: #f8fafc; font-family: sans-serif;">
            <div style="text-align: center; padding-top: 100px; color: #1e293b;">
              <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); display: inline-block; max-width: 450px;">
                <div style="background: #fee2e2; color: #991b1b; padding: 12px; border-radius: 8px; margin-bottom: 20px; font-weight: 500;">
                  Access Restricted
                </div>
                <h2 style="margin-top: 0; font-size: 20px;">@orns.org Account Required</h2>
                <p style="color: #64748b; margin-bottom: 24px; line-height: 1.5;">
                  You signed in with <strong>${email}</strong>. 
                  Unfortunately, this app is restricted to users within the <strong>@orns.org</strong> domain.
                </p>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                  <button onclick="window.location.href='/api/auth/url?retry=true'" style="background: #0f172a; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px;">
                    Sign in with a different account
                  </button>
                  <button onclick="window.close()" style="background: transparent; color: #64748b; border: 1px solid #e2e8f0; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 13px;">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
            <script>
              // If directed here from another endpoint, handle the URL gen
              if (window.location.search.includes('retry=true')) {
                fetch('/api/auth/url')
                  .then(r => r.json())
                  .then(data => {
                    if (data.url) window.location.href = data.url;
                  });
              }
            </script>
          </body>
        </html>
      `);
    }

    req.session.tokens = tokens;
    req.session.save((err) => {
      if (err) console.error("Session save error:", err);
      res.send(`
        <html>
          <body style="background: #f8fafc;">
            <div style="font-family: sans-serif; text-align: center; padding-top: 100px; color: #1e293b;">
              <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); display: inline-block; max-width: 400px;">
                <h2 style="margin-top: 0;">Authentication Successful</h2>
                <p style="color: #64748b;">You have successfully signed in with your ORNS account (${email}).</p>
                <p style="font-weight: 500; margin-bottom: 20px;">You can now close this window and return to the auction app.</p>
                <button onclick="window.close()" style="background: #0f172a; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: 600;">Close Window</button>
              </div>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                  // Give a slight delay before closing to ensure message is sent
                  setTimeout(() => window.close(), 1500);
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

app.get("/api/auth/callback", (req, res) => {
  // Redirect to the main callback
  const code = req.query.code;
  if (code) {
    res.redirect(`/auth/callback?code=${code}`);
  } else {
    res.status(404).send("Auth callback missing code");
  }
});

app.get("/api/auth/status", (req, res) => {
  res.json({ authenticated: !!req.session.tokens });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.clearCookie('__session');
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

// Create walk-in ticket via Apps Script (DEPRECATED: Use the transactional one below)
// app.post("/api/bidders/walk-in", ...);
// Removing this duplicate to ensure the transactional version at line 672 is used.

// Sync bidders via Apps Script
app.post("/api/bidders/sync", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { scriptId: bodyScriptId } = req.body;
  const scriptId = bodyScriptId || process.env.GOOGLE_SCRIPT_ID;
  if (!scriptId) return res.status(500).json({ error: "GOOGLE_SCRIPT_ID not configured. Please set it in Settings." });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const script = google.script({ version: "v1", auth: client });

    const response = await script.scripts.run({
      scriptId: scriptId,
      requestBody: {
        function: "apiSyncBidders",
        parameters: [],
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

    res.json({ success: true, result });
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

// Record winning bid with follow-up logic
app.post("/api/auction/record-winning-bid", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { 
    bidderId, 
    itemId, 
    price, 
    spreadsheetId, 
    bidManagementSheet, 
    bidderNumbersSheet,
    idempotencyKey 
  } = req.body;

  const cached = checkIdempotency(req, res, idempotencyKey);
  if (cached) return;

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    // 1. Get Bidder Info (to check if already checked out)
    const bidderSearch = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${bidderNumbersSheet}!A:G`,
    });
    const biddersRows = bidderSearch.data.values || [];
    const bidderRow = biddersRows.find((row: any) => row[0]?.toString() === bidderId);
    
    if (!bidderRow) {
      throw new Error(`Bidder ${bidderId} not found.`);
    }

    const isCheckedOut = bidderRow[6] === true || bidderRow[6] === "TRUE";

    // 2. Add Bid to Bid-Management Sheet
    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${bidManagementSheet}!1:300`,
    });
    const values = dataRes.data.values || [];
    if (values.length === 0) throw new Error("Bid sheet is empty");

    const header = values[0];
    let colIndex = -1;
    for (let j = 0; j < header.length; j += 2) {
      if (header[j]?.toString() === bidderId) {
        colIndex = j;
        break;
      }
    }
    if (colIndex === -1) throw new Error("Bidder column not found in Bid Management sheet");

    let rowIndex = -1;
    for (let i = 3; i < values.length; i++) {
      if (!values[i] || !values[i][colIndex]) {
        rowIndex = i + 1;
        break;
      }
    }
    if (rowIndex === -1) rowIndex = values.length + 1;
    if (rowIndex < 4) rowIndex = 4;

    const getColumnLetter = (index: number): string => {
      let letter = "";
      while (index >= 0) {
        letter = String.fromCharCode((index % 26) + 65) + letter;
        index = Math.floor(index / 26) - 1;
      }
      return letter;
    };

    const colLetter = getColumnLetter(colIndex);
    const nextColLetter = getColumnLetter(colIndex + 1);

    const operations: SheetOp[] = [];

    // Operation 1: Write the bid
    operations.push({
      type: 'UPDATE',
      spreadsheetId,
      range: `${bidManagementSheet}!${colLetter}${rowIndex}:${nextColLetter}${rowIndex}`,
      newValues: [[itemId, price]]
    });

    // Operation 2: Follow-Up logic if already checked out
    let followUpAdded = false;
    if (isCheckedOut) {
      // 3. Ensure Follow-Up sheet exists (optional but helpful)
      const metadata = await sheets.spreadsheets.get({ spreadsheetId });
      const followUpSheet = metadata.data.sheets?.find(s => s.properties?.title === "Follow-Up");
      
      if (!followUpSheet) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: { title: "Follow-Up" }
              }
            }]
          }
        });
        // Add header if new
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: "Follow-Up!A1:C1",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [["Bidder ID", "Item ID", "Amount"]]
          }
        });
      }

      operations.push({
        type: 'APPEND',
        spreadsheetId,
        range: `Follow-Up!A:C`,
        newValues: [[bidderId, itemId, price]]
      });
      followUpAdded = true;
    }

    await executeGoogleSheetsTransaction(sheets, operations);

    const result = { success: true, followUpAdded };
    saveIdempotency(idempotencyKey, result);
    res.json(result);

  } catch (error: any) {
    console.error("[Transaction Error] record-winning-bid:", error);
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

    console.log(`[Script API] Calling bridge function '${functionName}' with parameters:`, parameters);

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
      console.error("[Script API Response Error]", JSON.stringify(error, null, 2));
      return res.status(500).json({
        error: `Apps Script Execution Error: ${error.details?.[0]?.errorMessage || error.message}`,
        details: error
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
    console.error("[Script API] Request Exception:", error.response?.data || error);
    
    if (error.code === 404) {
      return res.status(404).json({ 
        error: "Script project not found. verify the Script ID in Settings." 
      });
    }
    
    if (error.code === 400) {
      const apiError = error.response?.data?.error || {};
      return res.status(400).json({
        error: `Invalid Request (400): ${apiError.message || "Check if the script ID is correct and the Google Apps Script API is enabled."}`,
        details: apiError
      });
    }

    if (error.code === 403) {
      const apiError = error.response?.data?.error || {};
      return res.status(403).json({
        error: `Access Denied (403): ${apiError.message || "Ensure Apps Script API is enabled at https://script.google.com/home/usersettings"}`,
        details: apiError
      });
    }
    
    res.status(500).json({ 
      error: error.message || "Failed to trigger Apps Script." 
    });
  }
});
// Request tracking for idempotency
const processedRequests = new Map<string, { timestamp: number, response: any }>();
// Cleanup old requests every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of processedRequests.entries()) {
    if (now - value.timestamp > 3600000) { // 1 hour TTL
      processedRequests.delete(key);
    }
  }
}, 3600000);

function checkIdempotency(req: express.Request, res: express.Response, key: string) {
  if (key && processedRequests.has(key)) {
    const cached = processedRequests.get(key);
    console.log(`[Idempotency] Request already processed: ${key}`);
    return res.json({ ...cached?.response, duplicated: true });
  }
  return null;
}

function saveIdempotency(key: string, response: any) {
  if (key) {
    processedRequests.set(key, { timestamp: Date.now(), response });
  }
}

interface SheetOp {
  spreadsheetId: string;
  range: string;
  newValues: any[][];
  type: 'UPDATE' | 'APPEND';
}

async function executeGoogleSheetsTransaction(
  sheets: any, 
  operations: SheetOp[]
) {
  const stagedOps = [];
  
  // Phase 1: Stage and Verify Targets
  for (const op of operations) {
    try {
      if (op.type === 'UPDATE') {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: op.spreadsheetId,
          range: op.range,
        });
        stagedOps.push({ ...op, oldValues: res.data.values || [] });
      } else if (op.type === 'APPEND') {
        const rangeParts = op.range.split('!');
        const sheetName = rangeParts[0];
        await sheets.spreadsheets.values.get({
          spreadsheetId: op.spreadsheetId,
          range: `${sheetName}!A1`, 
        });
        stagedOps.push({ ...op });
      }
    } catch (err: any) {
      throw new Error(`Transaction Staging Failed - Target not ready: ${op.spreadsheetId} ${op.range}. Error: ${err.message}`);
    }
  }
  
  // Phase 2: Commit Updates
  const completedOps = [];
  try {
    for (const op of stagedOps) {
      if (op.type === 'UPDATE') {
        await sheets.spreadsheets.values.update({
          spreadsheetId: op.spreadsheetId,
          range: op.range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: op.newValues }
        });
        completedOps.push(op);
      } else if (op.type === 'APPEND') {
        const appendRes = await sheets.spreadsheets.values.append({
          spreadsheetId: op.spreadsheetId,
          range: op.range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: op.newValues }
        });
        completedOps.push({ ...op, appendedRange: appendRes.data.updates.updatedRange });
      }
    }
  } catch (commitError: any) {
    console.error("[Transaction] Commit failed! Initiating rollback process...", commitError.message);
    
    // Phase 3: Rollback on Failure
    const rollbackErrors = [];
    for (let i = completedOps.length - 1; i >= 0; i--) {
      const opToRevert = completedOps[i];
      try {
        if (opToRevert.type === 'UPDATE') {
           const writeValues = opToRevert.oldValues && opToRevert.oldValues.length > 0
            ? opToRevert.oldValues 
            : opToRevert.newValues.map((row: any[]) => row.map(() => "")); // clean out block if originally empty

           await sheets.spreadsheets.values.update({
             spreadsheetId: opToRevert.spreadsheetId,
             range: opToRevert.range,
             valueInputOption: "USER_ENTERED",
             requestBody: { values: writeValues }
           });
        } else if (opToRevert.type === 'APPEND' && opToRevert.appendedRange) {
           await sheets.spreadsheets.values.clear({
             spreadsheetId: opToRevert.spreadsheetId,
             range: opToRevert.appendedRange,
           });
        }
      } catch (rollbackErr: any) {
         rollbackErrors.push(`Failed to revert ${opToRevert.range}: ${rollbackErr.message}`);
      }
    }
    
    if (rollbackErrors.length > 0) {
      throw new Error(`Transaction failed, and rollback partially failed (Mismatched state): ${commitError.message} | Rollback issues: ${rollbackErrors.join(', ')}`);
    } else {
      throw new Error(`Transaction failed and safely rolled back: ${commitError.message}`);
    }
  }
}

// transactional checkout
app.post("/api/auction/checkout-mark-paid", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { 
    bidderId, 
    spreadsheetId, 
    ticketsSpreadsheetId, 
    bidderNumbersSheet, 
    attendeeInfo,
    paymentMethod,
    idempotencyKey 
  } = req.body;

  const cached = checkIdempotency(req, res, idempotencyKey);
  if (cached) return;

  if (!spreadsheetId || !bidderId || !bidderNumbersSheet) {
    return res.status(400).json({ error: "Missing required parameters for checkout" });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    // 1. Find bidder row
    const bidderSearch = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${bidderNumbersSheet}!A:A`,
    });
    
    const biddersRows = bidderSearch.data.values || [];
    const rowIndex = biddersRows.findIndex((row: any) => row[0]?.toString() === bidderId) + 1;

    if (rowIndex <= 1) {
      throw new Error(`Bidder ${bidderId} not found in management sheet.`);
    }

    // 2. Perform writes (Simulated Transaction)
    const operations: SheetOp[] = [];

    // Write 1: Bidder Management Sheet (Mark Paid & Checked Out & Payment Method)
    operations.push({
      type: 'UPDATE',
      spreadsheetId,
      range: `${bidderNumbersSheet}!G${rowIndex}:I${rowIndex}`,
      newValues: [[true, true, paymentMethod || "Unknown"]]
    });

    // Write 2: Auction Tickets Sheet (if applicable)
    let attendeeUpdated = false;
    if (ticketsSpreadsheetId && attendeeInfo && attendeeInfo.sheet && attendeeInfo.rowIndex) {
      operations.push({
        type: 'UPDATE',
        spreadsheetId: ticketsSpreadsheetId,
        range: `${attendeeInfo.sheet}!U${attendeeInfo.rowIndex}`,
        newValues: [["Paid"]]
      });
      attendeeUpdated = true;
    }

    await executeGoogleSheetsTransaction(sheets, operations);

    const result = { success: true, attendeeUpdated };
    saveIdempotency(idempotencyKey, result);
    res.json(result);
  } catch (error: any) {
    console.error("[Transaction Error] checkout-mark-paid:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/auction/close-and-cleanup", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { spreadsheetId, bidderNumbersSheet, bidManagementSheet } = req.body;

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    // 1. Close Auction
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Auction-Status!A2",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[false]] }
    });

    // 2. Read Bidders
    const biddersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${bidderNumbersSheet}!A:H`
    });
    const bidderRows = biddersRes.data.values || [];

    // 3. Read Winners (to find out who won anything)
    const bidRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${bidManagementSheet}!A:ZZ`
    });
    const bidRows = bidRes.data.values || [];
    
    const winnersSet = new Set<string>();
    if (bidRows.length > 0) {
      const header = bidRows[0];
      for (let j = 0; j < header.length; j += 2) {
        const bidderId = header[j];
        if (!bidderId) continue;
        
        let hasWins = false;
        for (let i = 3; i < bidRows.length; i++) {
          if (bidRows[i] && bidRows[i][j]) {
            hasWins = true;
            break;
          }
        }
        if (hasWins) winnersSet.add(bidderId.toString());
      }
    }

    // 4. Update Bidders
    const updates: any[] = [];
    for (let i = 1; i < bidderRows.length; i++) {
      const id = bidderRows[i][0]?.toString();
      const checkedOut = bidderRows[i][6] === "TRUE" || bidderRows[i][6] === "true";
      
      if (id && !checkedOut && !winnersSet.has(id)) {
        updates.push({
          range: `${bidderNumbersSheet}!G${i + 1}:H${i + 1}`,
          values: [[true, true]] 
        });
      }
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          data: updates,
          valueInputOption: "USER_ENTERED"
        }
      });
    }

    res.json({ success: true, count: updates.length });
  } catch (error: any) {
    console.error("[Auction Close Error]:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update walk-in to be transactional across sheets
app.post("/api/bidders/walk-in", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { 
    firstName, 
    lastName, 
    email, 
    scriptId: bodyScriptId, 
    spreadsheetId, 
    ticketsSpreadsheetId,
    ticketPrice,
    idempotencyKey 
  } = req.body;

  const cached = checkIdempotency(req, res, idempotencyKey);
  if (cached) return;

  const scriptId = bodyScriptId || process.env.GOOGLE_SCRIPT_ID;
  if (!scriptId) return res.status(500).json({ error: "GOOGLE_SCRIPT_ID missing" });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const script = google.script({ version: "v1", auth: client });
    const sheets = google.sheets({ version: "v4", auth: client });

    // Step 0: Pre-verify Tickets Sheet if provided (Staging to prevent mismatched states)
    let targetSheetName = "tickets";
    if (ticketsSpreadsheetId) {
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: ticketsSpreadsheetId });
      const sheet = spreadsheet.data.sheets?.find(s => 
        s.properties?.title?.toLowerCase() === "tickets"
      );
      targetSheetName = sheet?.properties?.title || "tickets";
      
      // Verify we can access/append to this range
      await sheets.spreadsheets.values.get({
        spreadsheetId: ticketsSpreadsheetId,
        range: `${targetSheetName}!A1`, 
      });
    }

    // Step 1: Apps Script call (Creates bidder number)
    const scriptResponse = await script.scripts.run({
      scriptId: scriptId,
      requestBody: {
        function: "apiCreateWalkInTicket",
        parameters: spreadsheetId ? [firstName, lastName, email, spreadsheetId] : [firstName, lastName, email],
        devMode: true,
      },
    });

    if (scriptResponse.data.error) throw new Error(scriptResponse.data.error.message);
    const scriptResult: any = scriptResponse.data.response?.result;
    if (scriptResult && scriptResult.success === false) throw new Error(scriptResult.error);

    // Step 2: Write to Tickets Spreadsheet if provided
    let ticketAppended = false;
    let appendError = null;
    if (ticketsSpreadsheetId) {
      try {
        const rowValue = new Array(22).fill("");
        rowValue[0] = firstName;
        rowValue[1] = lastName;
        rowValue[2] = email || "";
        rowValue[4] = "1";
        rowValue[5] = "FALSE";
        rowValue[19] = "Auction Checkout"; 
        rowValue[20] = "Pending";
        rowValue[21] = `$${ticketPrice || 35}`; 
        
        await executeGoogleSheetsTransaction(sheets, [{
          type: 'APPEND',
          spreadsheetId: ticketsSpreadsheetId,
          range: `${targetSheetName}!A:V`,
          newValues: [rowValue]
        }]);
        ticketAppended = true;
      } catch (err: any) {
        console.warn("[Transaction] Walk-in ticket append failed:", err.message);
        appendError = err.message;
      }
    }

    const result = { 
      success: scriptResult?.success, 
      bidder: scriptResult?.bidder, 
      ticketAppended, 
      appendError: appendError || null 
    };
    saveIdempotency(idempotencyKey, result);
    res.json(result);

  } catch (error: any) {
    console.error("[Transaction Error] walk-in:", error);
    res.status(500).json({ error: error.message });
  }
});

// Transactional Check-in with optional Bid (e.g. for unpaid tickets)
app.post("/api/auction/check-in-with-bid", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { 
    bidderId, 
    spreadsheetId, 
    bidManagementSheet, 
    bidderNumbersSheet, 
    bidValue,
    idempotencyKey 
  } = req.body;

  const cached = checkIdempotency(req, res, idempotencyKey);
  if (cached) return;

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    // 1. Add Bid to Bid-Management Sheet
    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${bidManagementSheet}!1:300`,
    });
    const values = dataRes.data.values || [];
    if (values.length === 0) throw new Error("Bid sheet is empty");

    const header = values[0];
    let colIndex = -1;
    for (let j = 0; j < header.length; j += 2) {
      if (header[j]?.toString() === bidderId) {
        colIndex = j;
        break;
      }
    }
    if (colIndex === -1) throw new Error("Bidder column not found");

    let rowIndex = -1;
    for (let i = 3; i < values.length; i++) {
      if (!values[i] || !values[i][colIndex]) {
        rowIndex = i + 1;
        break;
      }
    }
    if (rowIndex === -1) rowIndex = values.length + 1;
    if (rowIndex < 4) rowIndex = 4;

    const getColumnLetter = (index: number): string => {
      let letter = "";
      while (index >= 0) {
        letter = String.fromCharCode((index % 26) + 65) + letter;
        index = Math.floor(index / 26) - 1;
      }
      return letter;
    };

    const colLetter = getColumnLetter(colIndex);
    const nextColLetter = getColumnLetter(colIndex + 1);

    const operations: SheetOp[] = [];

    // Write Bid
    operations.push({
      type: 'UPDATE',
      spreadsheetId,
      range: `${bidManagementSheet}!${colLetter}${rowIndex}:${nextColLetter}${rowIndex}`,
      newValues: [["1606", bidValue]]
    });

    // 2. Mark Checked In in Bidder Numbers Sheet
    const bidderSearch = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${bidderNumbersSheet}!A:A`,
    });
    const biddersRows = bidderSearch.data.values || [];
    const bidderRowIndex = biddersRows.findIndex((row: any) => row[0]?.toString() === bidderId) + 1;

    if (bidderRowIndex > 1) {
      operations.push({
        type: 'UPDATE',
        spreadsheetId,
        range: `${bidderNumbersSheet}!E${bidderRowIndex}`,
        newValues: [[true]]
      });
    }

    await executeGoogleSheetsTransaction(sheets, operations);

    const result = { success: true, bidAdded: true, checkedIn: true };
    saveIdempotency(idempotencyKey, result);
    res.json(result);

  } catch (error: any) {
    console.error("[Transaction Error] check-in-with-bid:", error);
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/bundle/suggest-names", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured in the environment." });
  }

  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "No items provided for suggestions" });
  }

  try {
    const itemsDescription = items.map((it: any) => `- ${it.name}: ${it.description || 'No description'}`).join('\n');
    const prompt = `Suggested names for bundle: ${itemsDescription}`;

    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const result = await genAI.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction: "You are an expert at creating catchy, themed bundle names for a non-profit preschool's silent auction. Return JSON array of 5 strings.",
        responseMimeType: "application/json"
      }
    });

    // Audit finish reason
    const finishReason = result.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.warn(`[AI Audit] Finish reason was not STOP: ${finishReason}`);
      return res.status(503).json({ 
        error: "AI generation interrupted", 
        fallback: true 
      });
    }

    try {
      const rawText = result.text || "[]";
      let cleanedText = rawText.trim();
      if (cleanedText.startsWith("```json")) {
        cleanedText = cleanedText.replace(/^```json\n?/, "").replace(/\n?```$/, "");
      } else if (cleanedText.startsWith("```")) {
        cleanedText = cleanedText.replace(/^```\n?/, "").replace(/\n?```$/, "");
      }
      
      const suggestions = JSON.parse(cleanedText);
      res.json({ suggestions });
    } catch (parseError) {
      console.error("[AI Audit] JSON parse failed:", parseError);
      return res.status(502).json({ error: "Malformed AI response", fallback: true });
    }
  } catch (error: any) {
    console.error("Gemini suggestion error:", error);
    res.status(500).json({ error: error.message, fallback: true });
  }
});

// Gemini Suggest Bundle Description
app.post("/api/bundle/suggest-description", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured in the environment." });
  }

  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "No items provided for description suggestions" });
  }

  try {
    const itemsList = items.map((it: any) => `- ${it.name}: ${it.description || 'No description'}`).join('\n');
    const prompt = `Write a professional, catchy, and appealing auction description for a bundle containing these items:
    ${itemsList}
    
    The description MUST be exactly one paragraph long, professional yet exciting for a school fundraiser. Don't use placeholders. Focus on the value and experience of the bundle.`;

    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const result = await genAI.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction: "You are an expert at writing compelling silent auction descriptions for non-profit preschool fundraisers. Return a plain text description that is exactly one paragraph long.",
      }
    });

    const finishReason = result.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      return res.status(503).json({ error: "AI generation interrupted", fallback: true });
    }

    res.json({ description: result.text });
  } catch (error: any) {
    console.error("Gemini description error:", error);
    res.status(500).json({ error: error.message, fallback: true });
  }
});

// List Auction Backups
app.get("/api/backups/list/:spreadsheetId", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: req.params.spreadsheetId,
    });

    const backupSheets = metadata.data.sheets?.filter(s => 
      s.properties?.title?.startsWith("Auction-Items Back Up (")
    ).map(s => ({
      title: s.properties?.title,
      sheetId: s.properties?.sheetId,
      index: s.properties?.index
    })) || [];

    res.json(backupSheets);
  } catch (error: any) {
    if (error.code === 404) {
      return res.status(404).json({ error: "Spreadsheet not found. Please check the Spreadsheet ID in Settings." });
    }
    res.status(500).json({ error: error.message });
  }
});

// Restore Auction Backup
app.post("/api/backups/restore", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { spreadsheetId, backupSheetName } = req.body;
  if (!spreadsheetId || !backupSheetName) return res.status(400).json({ error: "Missing required parameters" });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const metadata = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetsList = metadata.data.sheets || [];
    
    const currentSheet = sheetsList.find(s => s.properties?.title === "Auction-Items");
    const backupSheet = sheetsList.find(s => s.properties?.title === backupSheetName);

    if (!backupSheet) throw new Error("Backup sheet not found");

    const requests: any[] = [];
    const timestamp = new Date().getTime();

    // 1. Rename current to an archive name
    if (currentSheet) {
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId: currentSheet.properties?.sheetId,
            title: `Auction-Items (Archived ${timestamp})`
          },
          fields: "title"
        }
      });
    }

    // 2. Duplicate backup sheet
    requests.push({
      duplicateSheet: {
        sourceSheetId: backupSheet.properties?.sheetId,
        newSheetName: "Auction-Items",
        insertSheetIndex: 0
      }
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests }
    });

    res.json({ success: true });
  } catch (error: any) {
    if (error.code === 404) {
      return res.status(404).json({ error: "Spreadsheet not found. Please check the Spreadsheet ID in Settings." });
    }
    res.status(500).json({ error: error.message });
  }
});

// Bundling & Restoration Workflow Endpoints
app.post("/api/bundle/process", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { spreadsheetId, targetIds, newName, newDescription, targetCategory, timestamp, idempotencyKey } = req.body;
  const cached = checkIdempotency(req, res, idempotencyKey);
  if (cached) return;

  if (!spreadsheetId || !targetIds || !targetIds.length || !newName || !targetCategory) {
    return res.status(400).json({ error: "Missing required bundling parameters" });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const metadata = await sheets.spreadsheets.get({ spreadsheetId });
    const auctionItemsSheet = metadata.data.sheets?.find(s => s.properties?.title === "Auction-Items");
    if (!auctionItemsSheet) throw new Error("Target sheet 'Auction-Items' not found");

    const catSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Categories!A:C" });
    const baseNumbers: Record<string, number> = {};
    (catSearch.data.values || []).slice(1).forEach(row => {
      if (row[0] && row[2]) baseNumbers[row[0].trim()] = parseInt(row[2], 10) || 0;
    });

    const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Auction-Items!A:L" });
    const values = dataRes.data.values || [];
    const ts = timestamp || new Date().toLocaleString('en-US', { hour12: false }).replace(/\//g, '-');
    const bundleEventToken = "BND-" + ts.replace(/[^0-9]/g, '');
    
    const rowsToUpdate: any[] = [];
    const originalNames: string[] = [];
    let totalValue = 0;
    const originalDonors: string[] = [];
    const originalItemTypes: string[] = [];

    const targetSet = new Set(targetIds.map((id: string) => id.toString()));
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const id = row[0]?.toString();
      if (id && targetSet.has(id)) {
        originalNames.push(row[2] || "Unknown");
        totalValue += parseFloat((row[4] || "0").replace(/[^0-9.-]+/g, "")) || 0;
        if (row[7]) originalDonors.push(row[7]);
        if (row[8]) originalItemTypes.push(row[8]);
        
        row[0] = ""; 
        row[9] = "Inactive"; 
        row[10] = bundleEventToken;
        row[11] = ts;
      }
    }

    let nextId = baseNumbers[targetCategory] > 0 ? baseNumbers[targetCategory] : 1;
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      if (row[1] === targetCategory && row[9] === "Active") {
        const idNum = parseInt(row[0], 10);
        if (!isNaN(idNum) && idNum >= nextId) nextId = idNum + 1;
      }
    }
    const tempBundleId = nextId.toString();

    const donorString = Array.from(new Set(originalDonors)).join(" / ");
    
    // Type logic
    const uniqueTypes = Array.from(new Set(originalItemTypes));
    let finalType = "Both";
    if (uniqueTypes.length === 1) finalType = uniqueTypes[0];

    const openingBid = "$" + (Math.ceil((totalValue * 0.4) / 5) * 5).toFixed(0);
    const minRaise = "$" + (Math.ceil((totalValue * 0.1) / 5) * 5).toFixed(0);
    const valString = "$" + totalValue.toFixed(0);

    const newRow = [
      tempBundleId, targetCategory, newName, newDescription, valString, openingBid, minRaise, donorString, finalType, "Active", bundleEventToken, ""
    ];
    values.push(newRow);

    const affectedCategories = new Set<string>();
    affectedCategories.add(targetCategory);
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      if (row[10] === bundleEventToken && row[9] === "Inactive") {
        affectedCategories.add(row[1]);
      }
    }

    for (const cat of affectedCategories) {
      const rowMapping: {origIndex: number, row: any[]}[] = [];
      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        if (row[1] === cat && row[9] === "Active" && row[0] !== "") {
          rowMapping.push({ origIndex: i, row });
        }
      }
      rowMapping.sort((a, b) => {
        const idA = parseInt(a.row[0]) || 999999;
        const idB = parseInt(b.row[0]) || 999999;
        return idA - idB;
      });
      let startNum = baseNumbers[cat] > 0 ? baseNumbers[cat] : 1;
      rowMapping.forEach(item => { item.row[0] = startNum.toString(); startNum++; });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId, range: "Auction-Items!A1:L", valueInputOption: "USER_ENTERED", requestBody: { values }
    });

    const responsePayload = {
      action_executed: "BUNDLE_ITEMS",
      affected_categories: Array.from(affectedCategories),
      ui_history_log: { 
        bundle_token: bundleEventToken, 
        timestamp: ts, 
        bundle_item_name: newName, 
        original_item_names: originalNames 
      },
      rows_to_update: values.map((row, i) => ({
        row_index: i + 1,
        column_updates: { A: row[0], J: row[9], K: row[10], L: row[11] }
      }))
    };
    saveIdempotency(idempotencyKey, responsePayload);
    res.json(responsePayload);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/bundle/restore", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { spreadsheetId, targetBundleToken, idempotencyKey } = req.body;
  const cached = checkIdempotency(req, res, idempotencyKey);
  if (cached) return;

  if (!spreadsheetId || !targetBundleToken) return res.status(400).json({ error: "Missing required parameters (targetBundleToken)" });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const catSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Categories!A:C" });
    const baseNumbers: Record<string, number> = {};
    (catSearch.data.values || []).slice(1).forEach(row => {
      if (row[0] && row[2]) baseNumbers[row[0].trim()] = parseInt(row[2], 10) || 0;
    });

    const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Auction-Items!A:L" });
    const values = dataRes.data.values || [];
    
    let bundleName = "Unknown Bundle";
    const originalNames: string[] = [];
    const affectedCategories = new Set<string>();
    let bundleRowFound = false;

    // 1. Identify and Remove the Active Bundle
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      if (row[10]?.toString() === targetBundleToken?.toString() && row[9] === "Active") {
        bundleName = row[2] || "Unknown Bundle";
        affectedCategories.add(row[1]);
        // Remove row from active sequence by setting to inactive and clearing ID
        row[0] = "";
        row[9] = "Inactive";
        row[10] = ""; // Clear token so it's not restored again
        bundleRowFound = true;
        break; 
      }
    }

    if (!bundleRowFound) return res.status(404).json({ error: "Active bundle with provided token not found" });

    // 2. Restore Original Items
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      if (row[10]?.toString() === targetBundleToken?.toString() && row[9] === "Inactive") {
        originalNames.push(row[2]);
        affectedCategories.add(row[1]);
        row[9] = "Active"; 
        row[10] = "";       
        row[11] = "";       
      }
    }

    // 3. Run Re-Sequencing Cleanup
    for (const cat of affectedCategories) {
      const rowMapping: {origIndex: number, row: any[]}[] = [];
      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        if (row[1] === cat && row[9] === "Active") {
          rowMapping.push({ origIndex: i, row });
        }
      }
      rowMapping.sort((a, b) => {
        const idA = parseInt(a.row[0]) || 999999;
        const idB = parseInt(b.row[0]) || 999999;
        return idA - idB;
      });
      let startNum = baseNumbers[cat] > 0 ? baseNumbers[cat] : 1;
      rowMapping.forEach(item => { item.row[0] = startNum.toString(); startNum++; });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId, range: "Auction-Items!A1:L", valueInputOption: "USER_ENTERED", requestBody: { values }
    });

    const responsePayload = {
      action_executed: "RESTORE_BUNDLE",
      affected_categories: Array.from(affectedCategories),
      ui_history_log: { 
        bundle_token: targetBundleToken, 
        timestamp: new Date().toISOString(), 
        bundle_item_name: bundleName, 
        original_item_names: originalNames 
      },
      rows_to_update: values.map((row, i) => ({
        row_index: i + 1,
        column_updates: { A: row[0], J: row[9], K: row[10], L: row[11] }
      }))
    };
    saveIdempotency(idempotencyKey, responsePayload);
    res.json(responsePayload);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    if (error.code === 404) {
      return res.status(404).json({ error: "Spreadsheet or Settings tab not found. Please check your IDs." });
    }
    res.status(500).json({ error: error.message });
  }
});

// Delete Auction Item Row
app.post("/api/auction/delete-item", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { spreadsheetId, rowIndex } = req.body;
  if (!spreadsheetId || !rowIndex) {
    return res.status(400).json({ error: "Missing required parameters for deletion" });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    // 1. Get sheetId for "Auction-Items"
    const metadata = await sheets.spreadsheets.get({ spreadsheetId });
    const auctionItemsSheet = metadata.data.sheets?.find(s => s.properties?.title === "Auction-Items");
    if (!auctionItemsSheet) throw new Error("Target sheet 'Auction-Items' not found");
    const sourceSheetId = auctionItemsSheet.properties?.sheetId;

    if (sourceSheetId === undefined) throw new Error("Could not determine sheetId");

    // 2. Delete the row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sourceSheetId,
              dimension: "ROWS",
              startIndex: rowIndex - 1,
              endIndex: rowIndex
            }
          }
        }]
      }
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("[Server Error] delete-item:", error);
    res.status(500).json({ error: error.message });
  }
});

// Sheet API Cache
const sheetCache = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds cache

// Sheet API Proxy
app.get("/api/sheets/:spreadsheetId/:range", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { spreadsheetId, range } = req.params;
  const cacheKey = `${spreadsheetId}:${range}`;
  const cached = sheetCache.get(cacheKey);

  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log(`[Cache Hit] GET ${spreadsheetId} / ${range}`);
    return res.json(cached.data);
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    
    // Update cache
    sheetCache.set(cacheKey, { data: result.data, timestamp: Date.now() });
    
    res.json(result.data);
  } catch (error: any) {
    console.error(`[Sheets API Error] GET ${spreadsheetId}:`, error);
    if (error.code === 429) {
      return res.status(429).json({ error: "Google API Quota exceeded. Please wait a moment and try again." });
    }
    if (error.code === 404) {
      return res.status(404).json({ error: "Spreadsheet not found. Please check the Spreadsheet ID in Settings." });
    }
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sheets/:spreadsheetId/:range", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { spreadsheetId, range } = req.params;
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: req.body.values,
      },
    });
    
    // Invalidate cache for this sheet/range
    const cacheKey = `${spreadsheetId}:${range}`;
    sheetCache.delete(cacheKey);
    // Also invalidate any overlapping ranges (simplest is to clear all for this sheet)
    for (const key of sheetCache.keys()) {
      if (key.startsWith(`${spreadsheetId}:`)) {
        sheetCache.delete(key);
      }
    }

    res.json(result.data);
  } catch (error: any) {
    console.error(`[Sheets API Error] POST ${req.params.spreadsheetId}:`, error);
    if (error.code === 404) {
      return res.status(404).json({ error: "Spreadsheet not found. Please check the Spreadsheet ID in Settings." });
    }
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sheets/:spreadsheetId/:range/append", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { spreadsheetId, range } = req.params;
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: req.body.values,
      },
    });

    // Invalidate cache for this sheet
    for (const key of sheetCache.keys()) {
      if (key.startsWith(`${spreadsheetId}:`)) {
        sheetCache.delete(key);
      }
    }

    res.json(result.data);
  } catch (error: any) {
    console.error(`[Sheets API Error] APPEND ${req.params.spreadsheetId}:`, error);
    if (error.code === 404) {
      return res.status(404).json({ error: "Spreadsheet not found. Please check the Spreadsheet ID in Settings." });
    }
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sheets/:spreadsheetId/:range/clear", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { spreadsheetId, range } = req.params;
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    });

    // Invalidate cache for this sheet
    for (const key of sheetCache.keys()) {
      if (key.startsWith(`${spreadsheetId}:`)) {
        sheetCache.delete(key);
      }
    }

    res.json(result.data);
  } catch (error: any) {
    console.error(`[Sheets API Error] CLEAR ${req.params.spreadsheetId}:`, error);
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
    
    if (!req.params.folderId || req.params.folderId === "undefined" || req.params.folderId === "null" || req.params.folderId === "") {
      return res.json([]);
    }

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
    if (error.code === 404) {
      return res.status(404).json({ error: "Folder not found. Please check the folder ID in Settings." });
    }
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

// Gemini Assistant Endpoint
app.post("/api/assistant", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured in the environment." });
  }

  const { context, message, history } = req.body;
  if (!message) {
    return res.status(400).json({ error: "No message provided" });
  }

  try {
    // 1. Context Strategy: Pass contextual state via system instructions instead of injecting into user prompt
    // 2. Rolling Window: Keep only the last 10 messages (5 turns) to conserve tokens
    const recentHistory = Array.isArray(history) ? history.slice(-10) : [];
    
    const mappedContext = recentHistory.map((msg: any) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));

    mappedContext.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const result = await genAI.models.generateContent({
      model: modelName,
      contents: mappedContext,
      config: {
        systemInstruction: context || "You are an AI assistant for a charity auction.",
      }
    });

    const finishReason = result.candidates?.[0]?.finishReason;
    
    if (finishReason && finishReason !== 'STOP') {
      return res.status(503).json({ error: "AI generation interrupted", fallback: true });
    }

    res.json({ text: result.text });
  } catch (error: any) {
    console.error("Gemini assistant error:", error);
    res.status(500).json({ error: error.message, fallback: true });
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
