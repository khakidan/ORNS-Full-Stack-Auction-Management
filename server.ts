import express from "express";
import path from "path";
import fs from "fs";
import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";
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

    if (host && (host.includes("run.app") || host.includes("ais-") || host.includes("aistudio"))) {
      protocol = "https";
    }

    baseUrl = `${protocol}://${host}`;
  } else {
    baseUrl = process.env.APP_URL || "http://localhost:3000";
    if ((baseUrl.includes("run.app") || baseUrl.includes("ais-")) && baseUrl.startsWith("http:")) {
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
// Gemini Suggest Bundle Names
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

    const response = await genAI.models.generateContent({
      model: "gemini-flash-latest",
      contents: prompt,
      config: {
        systemInstruction: "You are an expert at creating catchy, themed bundle names for a non-profit preschool's silent auction. Return JSON array of 5 strings.",
        responseMimeType: "application/json"
      }
    });

    const rawText = response.text || "[]";
    let cleanedText = rawText.trim();
    if (cleanedText.startsWith("```json")) {
      cleanedText = cleanedText.replace(/^```json\n?/, "").replace(/\n?```$/, "");
    } else if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/^```\n?/, "").replace(/\n?```$/, "");
    }
    
    const suggestions = JSON.parse(cleanedText);
    res.json({ suggestions });
  } catch (error: any) {
    console.error("Gemini suggestion error:", error);
    res.status(500).json({ error: error.message });
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

    const response = await genAI.models.generateContent({
      model: "gemini-flash-latest",
      contents: prompt,
      config: {
        systemInstruction: "You are an expert at writing compelling silent auction descriptions for non-profit preschool fundraisers. Return a plain text description that is exactly one paragraph long.",
      }
    });

    res.json({ description: response.text });
  } catch (error: any) {
    console.error("Gemini description error:", error);
    res.status(500).json({ error: error.message });
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

// Execute Bundling Workflow
app.post("/api/bundle/execute", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { spreadsheetId, bundleRow, sourceRowIndices } = req.body;
  if (!spreadsheetId || !bundleRow || !sourceRowIndices || sourceRowIndices.length === 0) {
    return res.status(400).json({ error: "Missing required bundling parameters" });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    // 1. Create Backup
    const dateStr = new Date().toLocaleString().replace(/[\/:]/g, '-');
    const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId });
    const sourceSheetId = sheetInfo.data.sheets?.find(s => s.properties?.title === "Auction-Items")?.properties?.sheetId;
    
    if (sourceSheetId !== undefined) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            duplicateSheet: {
              sourceSheetId,
              newSheetName: `Auction-Items Back Up (${dateStr})`,
              insertSheetIndex: 1
            }
          }]
        }
      });
    }

    // 2. Append new bundled row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Auction-Items!A:J",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [bundleRow]
      }
    });

    // 3. Delete source rows
    // Sort indices descending to avoid shifting issues
    const sortedIndices = [...sourceRowIndices].sort((a, b) => b - a);
    
    const deleteRequests = sortedIndices.map(idx => ({
      deleteDimension: {
        range: {
          sheetId: sourceSheetId,
          dimension: "ROWS",
          startIndex: idx - 1,
          endIndex: idx
        }
      }
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: deleteRequests
      }
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("Bundling execution error:", error);
    if (error.code === 404) {
      return res.status(404).json({ error: "Spreadsheet not found. Please check the Spreadsheet ID in Settings." });
    }
    res.status(500).json({ error: error.message });
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
    if (error.code === 404) {
      return res.status(404).json({ error: "Spreadsheet or Settings tab not found. Please check your IDs." });
    }
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
