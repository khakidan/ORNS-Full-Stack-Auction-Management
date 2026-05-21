import express from "express";
import path from "path";
import fs from "fs";
import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";
import { processEmail, performSheetSync } from "./email-helpers.js";
import cookieSession from "cookie-session";

// Global resilient retry matrix for API calls (Exponential backoff & jitter is handled by gaxios internally)
google.options({
  retryConfig: {
    retry: 4,
    retryDelay: 1000,
    httpMethodsToRetry: ['GET', 'PUT', 'HEAD', 'OPTIONS', 'DELETE', 'POST', 'PATCH'],
    statusCodesToRetry: [[100, 199], [429, 429], [500, 599]],
  }
});
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import cors from "cors";

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

// Gemini AI setup
const genAI = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

function getCategoryBase(categoryName: string): number {
  if (!categoryName) return 1;
  const clean = categoryName.toLowerCase().replace(/&/g, "and").trim().replace(/\s+/g, " ");
  
  if (clean.includes("classroom art")) return 101;
  if (clean.includes("arts, crafts and jewelry") || clean.includes("arts, crafts & jewelry") || clean.includes("jewelry")) return 201;
  if (clean.includes("health & beauty") || clean.includes("health and beauty") || clean.includes("health") || clean.includes("beauty")) return 301;
  if (clean.includes("fitness")) return 401;
  if (clean.includes("kids activities") || clean.includes("kids activity") || clean.includes("kids")) return 501;
  if (clean.includes("retail")) return 601;
  if (clean.includes("entertainment") || clean.includes("experience")) return 701;
  if (clean.includes("food")) return 801;
  if (clean.includes("service")) return 901;
  if (clean.includes("classroom baskets") || clean.includes("classroom basket")) return 1001;
  if (clean.includes("travel")) return 1101;
  if (clean.includes("sports") || clean.includes("sports memorabilia") || clean.includes("ticket")) {
    if (clean.includes("raffle")) return 1501;
    return 1201;
  }
  if (clean.includes("live")) return 1301;
  if (clean.includes("movie")) return 1401;
  if (clean.includes("raffle")) return 1501;
  if (clean.includes("open appeal") || clean.includes("appeal")) return 1601;

  // Exact fallback matches
  const exactMatches: Record<string, number> = {
    "classroom art": 101,
    "arts, crafts and jewelry": 201,
    "arts, crafts & jewelry": 201,
    "health & beauty": 301,
    "health and beauty": 301,
    "fitness": 401,
    "kids activities": 501,
    "retail": 601,
    "entertainment & experiences": 701,
    "entertainment and experiences": 701,
    "food": 801,
    "services": 901,
    "classroom baskets": 1001,
    "travel": 1101,
    "sports memorabilia & tickets": 1201,
    "sports memorabilia and tickets": 1201,
    "live": 1301,
    "movie night": 1401,
    "raffle tickets": 1501,
    "open appeal": 1601
  };
  return exactMatches[clean] || 1;
}

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
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
  next();
});

app.set("trust proxy", 1);
const DATA_DIR = process.env.APP_DATA_DIR || process.cwd();

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
app.use((req, res, next) => {
  if (req.sessionOptions) {
    const host = req.get("host") || "";
    const isIframe = req.get("sec-fetch-dest") === "iframe" || host.includes("ais-dev-") || host.includes("ais-pre-");
    
    if (process.env.NODE_ENV === "production" && !host.includes("localhost")) {
      req.sessionOptions.secure = true;
      req.sessionOptions.sameSite = isIframe ? "none" : "lax";
    } else {
      req.sessionOptions.secure = false;
      req.sessionOptions.sameSite = "lax";
    }
  }
  next();
});

// Restore session tokens if present in client headers, bypassing cookie block restrictions
app.use((req, res, next) => {
  const tokenHeader = req.headers['x-google-tokens'];
  if (tokenHeader && typeof tokenHeader === 'string') {
    try {
      const parsed = JSON.parse(tokenHeader);
      if (parsed) {
        if (!req.session) {
          req.session = {};
        }
        req.session.tokens = parsed;
        console.log(`[Token Restorer] Successfully restored tokens for ${req.path}`);
      }
    } catch (e) {
      console.error("[Token Restorer] Failed to parse custom token header:", e);
    }
  }
  next();
});

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

    if (!req.session) {
      req.session = { tokens: null };
    }
    
    if (req.session) {
      const slimTokens = { ...tokens };
      delete slimTokens.id_token;
      
      // We don't strictly need to store scopes either if we know what they are,
      // but if the credential object strictly checks for it, we can leave it.
      // Better to delete it to further reduce cookie size.
      delete slimTokens.scope;
      
      req.session.tokens = slimTokens;
    }
    
    // Create a safe-to-serialize token backup
    const messageTokens = { ...tokens };
    delete messageTokens.id_token;
    delete messageTokens.scope;
    
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
                (function() {
                  var tokens = ${JSON.stringify(messageTokens)};
                  
                  // Save tokens to localStorage in the browser so that the main app receives them immediately
                  try {
                    localStorage.setItem('google_tokens', JSON.stringify(tokens));
                    console.log("Successfully cached tokens in localStorage from callback");
                  } catch (e) {
                    console.warn("localStorage failed in callback script:", e);
                  }

                  var isPopup = false;
                  try {
                    if (window.name === 'oauth_popup') {
                      isPopup = true;
                    }
                  } catch (e) {}

                  if (isPopup) {
                    var hasOpener = false;
                    try {
                      if (window.opener && window.opener !== window) {
                        hasOpener = true;
                      }
                    } catch (e) {}

                    if (hasOpener) {
                      try {
                        console.log("Sending successful auth tokens to main window opener...");
                        window.opener.postMessage({ 
                          type: 'OAUTH_AUTH_SUCCESS',
                          tokens: tokens
                        }, '*');
                        
                        var p = document.querySelector('p');
                        if (p) {
                          p.textContent = "Authenticated successfully with your ORNS account. This window will close automatically.";
                        }
                        
                        setTimeout(function() {
                          window.close();
                        }, 1000);
                        return;
                      } catch (e) {
                        console.error("Failed to post message to main window:", e);
                      }
                    }
                  }

                  // Non-popup flow (or fallback): redirect the main tab to the saved path or root
                  var redirectPath = '/';
                  try {
                    var savedPath = sessionStorage.getItem('post_auth_redirect_path');
                    if (savedPath && savedPath.slice(0, 1) === '/') {
                      redirectPath = savedPath;
                      sessionStorage.removeItem('post_auth_redirect_path');
                    }
                  } catch (e) {}

                  console.log("Redirecting to: " + redirectPath);
                  window.location.href = redirectPath;
                })();
              </script>
            </div>
          </body>
        </html>
      `);
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
  res.json({ authenticated: req.session && !!req.session.tokens });
});

app.post("/api/auth/logout", (req, res) => {
  req.session = null;
  res.clearCookie('__session');
  res.json({ success: true });
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

  const { bidderId, emailReceipt, scriptId: bodyScriptId, spreadsheetId, receiptFolderId } = req.body;
  const scriptId = bodyScriptId || process.env.GOOGLE_SCRIPT_ID;
  
  if (!scriptId) {
    return res.status(500).json({
      error: "GOOGLE_SCRIPT_ID is not configured. Please add it to the Settings tab in the app."
    });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const script = google.script({ version: "v1", auth: client });

    console.log(`[Script API] Calling bridge function 'apiCreateIndividualReceipt' for Bidder ${bidderId} with folder ${receiptFolderId}`);

    const response = await script.scripts.run({
      scriptId: scriptId,
      requestBody: {
        function: "apiCreateIndividualReceipt",
        parameters: [String(bidderId), !!emailReceipt, receiptFolderId || ""],
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
      docId: result?.docId,
      subtotal: result?.subtotal || 0,
      paymentUrl: result?.paymentUrl || ""
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

  const { scriptId: bodyScriptId, spreadsheetId, receiptFolderId } = req.body;
  const scriptId = bodyScriptId || process.env.GOOGLE_SCRIPT_ID;
  if (!scriptId) return res.status(500).json({ error: "GOOGLE_SCRIPT_ID not configured. Please set it in Settings." });

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const script = google.script({ version: "v1", auth: client });

    const response = await script.scripts.run({
      scriptId: scriptId,
      requestBody: {
        function: "apiCreateAllReceipts",
        parameters: [receiptFolderId || ""],
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

  const { spreadsheetId } = req.body;
  if (!spreadsheetId) {
    return res.status(400).json({ error: "spreadsheetId is required" });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });
    
    // Find all bidders with emails who won items
    const bNum = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Bidder-Numbers!A:L" });
    const numData = bNum.data.values || [];
    let sentCount = 0;
    
    for (let i = 1; i < numData.length; i++) {
      const id = String(numData[i][0] || "").trim();
      const email = String(numData[i][3] || "").trim();
      if (id && email) {
        // try to process their email
        const r = await processEmail(client, spreadsheetId, id);
        if (r.success) sentCount++;
      }
    }

    res.json({ success: true, sentCount });
  } catch (error: any) {
    console.error("[Server Error] email-all:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create walk-in ticket via Apps Script (DEPRECATED: Use the transactional one below)
// app.post("/api/bidders/walk-in", ...);
// Removing this duplicate to ensure the transactional version at line 672 is used.

app.post("/api/auction/setup-new", async (req, res) => {
  if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(`[Auction Setup] ${msg}`);
    logs.push(msg);
    res.write(JSON.stringify({ log: msg }) + "\n");
  };

  try {
    const parentFolderId = "0AFy4DQDukQdYUk9PVA";
    const archivedFolderId = "1J8fuh60tHdG_AAsl9fY8vpvstdXtxd-I";
    
    const { 
      ticketsSpreadsheetId, 
      itemEntrySpreadsheetId, 
      bidManagementSpreadsheetId 
    } = req.body;
    
    const client = getAuthenticatedClient(req.session.tokens);
    const drive = google.drive({ version: "v3", auth: client });
    const sheets = google.sheets({ version: "v4", auth: client });
    
    // 1. Calculate dates
    const today = new Date();
    let auctionYear = today.getFullYear();
    // Month is 0-indexed. April is 3. "Greater than April" means current month > 3
    if (today.getMonth() > 3) {
      auctionYear += 1;
    }
    const lastYear = auctionYear - 1;
    const maxArchiveYear = auctionYear - 2;
    const baseFolderName = `${auctionYear} Auction`;

    log(`Starting setup for auction year: ${auctionYear}`);

    // 2. Archive old folders && check for new folder existence
    log(`Scanning parent directory for existing folders...`);
    const folderRes = await drive.files.list({
      q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name, parents)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    
    log(`Found ${folderRes.data.files?.length || 0} existing folders in parent directory.`);
    
    const folders = folderRes.data.files || [];
    let lastYearFolderId: string | undefined;
    
    for (const folder of folders) {
      if (folder.name === baseFolderName) {
        log(`Error: Folder '${baseFolderName}' already exists.`);
        res.write(JSON.stringify({ error: `The '${baseFolderName}' folder already exists. Automation cancelled to prevent duplicates.` }) + "\n");
        return res.end();
      }
      
      const match = folder.name?.match(/^(\d{4}) Auction$/);
      if (match) {
        const folderYear = parseInt(match[1], 10);
        if (folderYear === lastYear) {
          lastYearFolderId = folder.id!;
        }
        if (folderYear <= maxArchiveYear) {
          // move to archive
          log(`Archiving old folder: ${folder.name}`);
          await drive.files.update({
            fileId: folder.id!,
            addParents: archivedFolderId,
            removeParents: parentFolderId,
            fields: 'id',
            supportsAllDrives: true
          });
        }
      }
    }
    
    // 3. Create new folder and subfolders
    log(`Creating new base folder: ${baseFolderName}`);
    const createFolder = async (name: string, parentId: string) => {
      const resp = await drive.files.create({
        requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
        fields: "id",
        supportsAllDrives: true
      });
      return resp.data.id!;
    };
    
    const newBaseFolderId = await createFolder(baseFolderName, parentFolderId);
    log(`Creating internal folders...`);
    const forPrintFolderId = await createFolder("For Print", newBaseFolderId);
    const bidderReceiptsFolderId = await createFolder("Bidder Receipts", newBaseFolderId);
    await createFolder("Software Development", newBaseFolderId);
    const volunteerDocsFolderId = await createFolder("Helpful Volunteer Documents", newBaseFolderId);
    
    // 4. Copy specific template files
    log(`Copying template files...`);
    const templateFiles = [  
      { id: "1GO-DvXuFfJLRyGgl9uavQl2Psn3kOPW9KkD8N9GQsvk", parent: volunteerDocsFolderId }, 
      { id: "1VSCNOc9f_usm0cNlUUyoT9TmKKouTJIOM0IQPSG21UU", parent: volunteerDocsFolderId }, 
      { id: "1rKooSWG2CxyAGowhjPpgw7-mZs8oklkYGVSpRsAYkyU", parent: newBaseFolderId },      
      { id: "1qQKGSIZxLK5OuE7uuXs6hQpDQIDc_IFOwP0nr3fXTYc", parent: newBaseFolderId },      
      { id: "1eA_7adFmclf8e5_PT-dTGgwfsDcNF8GjsA-wnxOFiyU", parent: newBaseFolderId },      
      { id: "1ON6sSUpQQdmpVsVPPCju-gKk-2Cf97RF2MM-t11Lfac", parent: newBaseFolderId },      
      { id: "10XqwqwSdjNv0PQfYTYgyCQ8WZBG5EXS-p75vm5lHLFs", parent: newBaseFolderId },      
      { id: "1ddUrxLA6A3LqUhArhuB3MuOC5z43eJmkts596aiUYOw", parent: newBaseFolderId }       
    ];
    
    for (const f of templateFiles) {
      try {
        const originalFile = await drive.files.get({ fileId: f.id, fields: "name", supportsAllDrives: true });
        log(`Copying template file: ${originalFile.data.name || f.id}`);
        await drive.files.copy({
          fileId: f.id,
          requestBody: { name: originalFile.data.name || "Copied File", parents: [f.parent] },
          fields: "id",
          supportsAllDrives: true
        });
      } catch (err: any) {
        log(`Failed to copy file ${f.id}: ${err.message}`);
      }
    }
    
    // 5. Backup master spreadsheets dynamically if they exist, into lastYearFolderId
    if (lastYearFolderId) {
      log(`Backing up master spreadsheets to last year's folder (${lastYear})...`);
      if (ticketsSpreadsheetId) {
        log(`Backing up Tickets spreadsheet...`);
        await drive.files.copy({
          fileId: ticketsSpreadsheetId,
          requestBody: { name: `${lastYear} Auction Tickets`, parents: [lastYearFolderId] },
          supportsAllDrives: true
        }).catch(err => log(`Error backing up Tickets: ${err.message}`));
      }
      
      if (itemEntrySpreadsheetId) {
        log(`Backing up Item Entry spreadsheet...`);
        await drive.files.copy({
          fileId: itemEntrySpreadsheetId,
          requestBody: { name: `${lastYear} Auction Items`, parents: [lastYearFolderId] },
          supportsAllDrives: true
        }).catch(err => log(`Error backing up Items: ${err.message}`));
      }
      
      if (bidManagementSpreadsheetId) {
        log(`Backing up Bid Management spreadsheet...`);
        await drive.files.copy({
          fileId: bidManagementSpreadsheetId,
          requestBody: { name: `${lastYear} Bid Management`, parents: [lastYearFolderId] },
          supportsAllDrives: true
        }).catch(err => log(`Error backing up Bid Management: ${err.message}`));
      }
    } else {
      log(`No folder found for ${lastYear} Auction, skipping spreadsheet backups.`);
    }
    
    // 6. Clean master spreadsheets
    log(`Cleaning data from master spreadsheets...`);
    try {
      if (itemEntrySpreadsheetId) {
        await sheets.spreadsheets.values.clear({
          spreadsheetId: itemEntrySpreadsheetId,
          range: "Auction-Items!A2:Z"
        }).catch(err => console.error("Failed to clear Item Entry sheets", err));
      }
      
      if (ticketsSpreadsheetId) {
        await sheets.spreadsheets.values.clear({
          spreadsheetId: ticketsSpreadsheetId,
          range: "'tickets'!A2:Z"
        }).catch(err => console.error("Failed to clear tickets sheet", err));
        
        await sheets.spreadsheets.values.clear({
          spreadsheetId: ticketsSpreadsheetId,
          range: "'sponsor tickets'!A2:Z"
        }).catch(err => console.error("Failed to clear sponsor tickets", err));
      }
      
      if (bidManagementSpreadsheetId) {
        // Find sheet IDs for Auction-Items, Bid-Management, Bidder-Numbers to delete them
        const shtInfo = await sheets.spreadsheets.get({ spreadsheetId: bidManagementSpreadsheetId });
        const shts = shtInfo.data.sheets || [];
        
        const reqs: any[] = [];
        
        shts.forEach(sheet => {
          const nm = sheet.properties?.title;
          const id = sheet.properties?.sheetId;
          const deleteSheetsList = ["Auction-Items", "Bid-Management", "Bidder-Numbers"];
          if (nm && deleteSheetsList.includes(nm) && id !== undefined) {
             reqs.push({ deleteSheet: { sheetId: id } });
          }
        });
        
        if (reqs.length > 0) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: bidManagementSpreadsheetId,
            requestBody: { requests: reqs }
          }).catch(err => console.error("Failed deleting sheets", err));
        }

        await sheets.spreadsheets.values.update({
          spreadsheetId: bidManagementSpreadsheetId,
          range: "'Auction-Status'!A2",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[true]] }
        }).catch(err => console.error("Failed Auction-Status", err));

        await sheets.spreadsheets.values.clear({
          spreadsheetId: bidManagementSpreadsheetId,
          range: "'Special-Winners'!B2:B3"
        }).catch(err => console.error("Failed Special-Winners clear", err));

        await sheets.spreadsheets.values.clear({
          spreadsheetId: bidManagementSpreadsheetId,
          range: "'Follow-Up'!A2:Z"
        }).catch(err => console.error("Failed Follow-Up clear", err));
      }
    } catch (err) {
      console.error("General error during sheet resets", err);
    }
    
    log(`Setup for new auction completed successfully!`);

    res.write(JSON.stringify({
      success: true,
      auctionYear,
      forPrintFolderId,
      bidderReceiptsFolderId,
      logs
    }) + "\n");
    res.end();

  } catch (error: any) {
    console.error("Setup Auction Flow Error:", error);
    res.status(500);
    res.write(JSON.stringify({ error: error.message || "Failed to setup new auction instance." }) + "\n");
    res.end();
  }
});

// Sync bidders via Node.js Google Sheets integration (migrated from apiSyncBidders Apps Script)
app.post("/api/bidders/sync", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { spreadsheetId } = req.body;
  if (!spreadsheetId) {
    return res.status(400).json({ error: "spreadsheetId is required to sync and setup bid management." });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    console.log(`[Sync Route] Initiating Native Node.js sheet setup for spreadsheet: ${spreadsheetId}...`);
    
    const result = await performSheetSync(client, spreadsheetId);
    
    res.json({ success: true, result });
  } catch (error: any) {
    console.error(`[Sync Route Error] Native synchronization flow failed:`, error);
    res.status(500).json({ error: error.message || "An error occurred during sheet synchronization." });
  }
});

// Dedicated endpoint to resend an email receipt via Apps Script
app.post("/api/receipts/email-only", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { bidderId, spreadsheetId } = req.body;
  if (!spreadsheetId) {
    return res.status(400).json({ error: "spreadsheetId is required" });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const result = await processEmail(client, spreadsheetId, String(bidderId));

    if (!result.success) {
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
    scriptId: bodyScriptId,
    paymentMethod,
    amount,
    idempotencyKey 
  } = req.body;

  const cached = checkIdempotency(req, res, idempotencyKey);
  if (cached) return;

  if (!spreadsheetId || !bidderId || !bidderNumbersSheet) {
    return res.status(400).json({ error: "Missing required parameters for checkout" });
  }

  const scriptId = bodyScriptId || process.env.GOOGLE_SCRIPT_ID;
  if (!scriptId) {
    return res.status(500).json({
      error: "GOOGLE_SCRIPT_ID is not configured. Please add it to the Settings tab in the app."
    });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    
    // Call Apps Script bridge function apiRecordPayment
    const script = google.script({ version: "v1", auth: client });
    console.log(`[Script API] Calling bridge function 'apiRecordPayment' for Bidder ${bidderId}`);
    
    const parsedAmount = typeof amount === "string" ? parseFloat(amount.replace(/[^0-9.]/g, "")) : Number(amount);

    const scriptResponse = await script.scripts.run({
      scriptId: scriptId,
      requestBody: {
        function: "apiRecordPayment",
        parameters: [String(bidderId), paymentMethod || "CASH"],
        devMode: true,
      },
    });
    
    if (scriptResponse.data.error) {
      const eData = scriptResponse.data.error.details?.[0] as any;
      throw new Error(eData?.errorMessage || "Unknown Apps Script execution error");
    }

    const { response } = scriptResponse.data;
    if (response?.result && typeof response.result === 'object') {
      const resultObj = response.result as any;
      if (resultObj.success === false) {
        throw new Error(resultObj.error || "Failed to record payment in Google Apps Script");
      }
    }

    // Optional: Write 2: Auction Tickets Sheet (if applicable)
    let attendeeUpdated = false;
    if (ticketsSpreadsheetId && attendeeInfo && attendeeInfo.sheet && attendeeInfo.rowIndex) {
      const sheets = google.sheets({ version: "v4", auth: client });
      const operations: SheetOp[] = [];
      operations.push({
        type: 'UPDATE',
        spreadsheetId: ticketsSpreadsheetId,
        range: `${attendeeInfo.sheet}!U${attendeeInfo.rowIndex}`,
        newValues: [["Paid"]]
      });
      await executeGoogleSheetsTransaction(sheets, operations);
      attendeeUpdated = true;
    }

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
    bidderNumbersSheet,
    bidManagementSheet,
    idempotencyKey 
  } = req.body;

  const cached = checkIdempotency(req, res, idempotencyKey);
  if (cached) return;

  const scriptId = bodyScriptId || process.env.GOOGLE_SCRIPT_ID;
  if (!scriptId) return res.status(500).json({ error: "GOOGLE_SCRIPT_ID missing" });

  if (!bidderNumbersSheet || !bidManagementSheet) {
     return res.status(400).json({ error: "Missing required sheet names for walk-in." });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
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

    console.log("[Walk-In] Fetching metadata for Spreadsheet IDs to perform native Google Sheet integration...");

    // NATIVE REPLACEMENT FOR Apps Script "apiCreateWalkInTicket"
    // Step A: Fetch Sheet IDs for insertDimension
    const metadata = await sheets.spreadsheets.get({ spreadsheetId });
    const bdSheet = metadata.data.sheets?.find(s => s.properties?.title === bidderNumbersSheet);
    const bmSheet = metadata.data.sheets?.find(s => s.properties?.title === bidManagementSheet);
    
    if (!bdSheet || !bmSheet) {
      throw new Error("[Walk-In] Could not find Bidder-Numbers or Bid-Management sheet IDs. Please verify settings.");
    }

    console.log("[Walk-In] Fetching current bidders to calculate new bidder ID...");
    // Step B: Calculate new Bidder ID
    const bdData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${bidderNumbersSheet}!A:A`
    });
    const bdRows = bdData.data.values || [];
    const formatName = (str: string) => str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
    const formattedFirst = formatName(firstName);
    const formattedLastName = formatName(lastName);
    const formattedEmail = (email || "").trim();

    const maxId = bdRows.slice(1).reduce((max: number, row: any) => Math.max(max, parseInt(row[0]) || 0), 100);
    const newId = maxId + 1;
    
    console.log(`[Walk-In] New Bidder ID calculated: ${newId}. Attempting to create bid management columns...`);

    // Step C: Find last column in Bid-Management
    const bmData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${bidManagementSheet}!1:5`
    });
    
    let maxCols = 0;
    (bmData.data.values || []).forEach((row: any[]) => {
      maxCols = Math.max(maxCols, row.length);
    });
    
    let lastColIndex = maxCols;
    
    // Ensure we start on an even column boundary (0-indexed, if 2 cols per bidder)
    if (lastColIndex % 2 !== 0) {
      lastColIndex += 1;
    }
    
    const totalCols = bmSheet.properties?.gridProperties?.columnCount || 0;
    if (totalCols <= lastColIndex + 2) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              appendDimension: {
                sheetId: bmSheet.properties?.sheetId,
                dimension: "COLUMNS",
                length: Math.max(2, (lastColIndex + 2) - totalCols + 2)
              }
            }
          ]
        }
      });
      console.log(`[Walk-In] Successfully appended columns to Bid-Management.`);
    }

    // Step D: Write new data to both sheets
    const getColumnLetter = (index: number): string => {
      let letter = "";
      while (index >= 0) {
        letter = String.fromCharCode((index % 26) + 65) + letter;
        index = Math.floor(index / 26) - 1;
      }
      return letter;
    };

    const newColLetter = getColumnLetter(lastColIndex);
    const nextColLetter = getColumnLetter(lastColIndex + 1);
    
    const operations: any[] = [];
    
    // Bidder-Numbers append
    operations.push({
      type: 'APPEND',
      spreadsheetId,
      range: `${bidderNumbersSheet}!A:H`,
      newValues: [[newId, formattedFirst, formattedLastName, formattedEmail, true, false, false, false]]
    });

    // Bid-Management header formatting
    operations.push({
      type: 'UPDATE',
      spreadsheetId,
      range: `${bidManagementSheet}!${newColLetter}1:${nextColLetter}4`,
      newValues: [
        [newId, ""],
        [formattedFirst, formattedLastName],
        ['Item #:', 'Price:'],
        ['Walk-In Ticket', ticketPrice || 35]
      ]
    });

    console.log(`[Walk-In] Executing Google Sheets transaction to apply Walk-in data...`);
    await executeGoogleSheetsTransaction(sheets, operations);

    console.log(`[Walk-In] Applying rich formatting to Bid-Management...`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            mergeCells: {
              range: {
                sheetId: bmSheet.properties?.sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: lastColIndex,
                endColumnIndex: lastColIndex + 2
              },
              mergeType: "MERGE_ALL"
            }
          },
          {
            repeatCell: {
              range: {
                sheetId: bmSheet.properties?.sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: lastColIndex,
                endColumnIndex: lastColIndex + 2
              },
              cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
              fields: "userEnteredFormat.horizontalAlignment"
            }
          },
          {
            repeatCell: {
              range: {
                sheetId: bmSheet.properties?.sheetId,
                startRowIndex: 1,
                endRowIndex: 2,
                startColumnIndex: lastColIndex,
                endColumnIndex: lastColIndex + 2
              },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: "userEnteredFormat.textFormat.bold"
            }
          }
        ]
      }
    });
    console.log(`[Walk-In] Successfully completed Bid-Management column formatting.`);

    const scriptResult = {
      success: true,
      bidder: { id: newId, firstName: formattedFirst, lastName: formattedLastName }
    };

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
      const catName = (row[0] || "").toString().trim();
      const catBase = parseInt(row[1] || row[2] || "0", 10) || 0;
      if (catName) {
        baseNumbers[catName] = catBase || getCategoryBase(catName);
      }
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

    const startBase = baseNumbers[targetCategory] || getCategoryBase(targetCategory);
    let nextId = startBase;
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
      const startNum = baseNumbers[cat] || getCategoryBase(cat);
      let runningNum = startNum;
      rowMapping.forEach(item => { item.row[0] = runningNum.toString(); runningNum++; });
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
      const catName = (row[0] || "").toString().trim();
      const catBase = parseInt(row[1] || row[2] || "0", 10) || 0;
      if (catName) {
        baseNumbers[catName] = catBase || getCategoryBase(catName);
      }
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
      const startNum = baseNumbers[cat] || getCategoryBase(cat);
      let runningNum = startNum;
      rowMapping.forEach(item => { item.row[0] = runningNum.toString(); runningNum++; });
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

// Add Auction Item and resequence
app.post("/api/auction/add-item", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { spreadsheetId, category, name, description, value, openingBid, minRaise, donor, itemType } = req.body;
  if (!spreadsheetId || !category || !name) {
    return res.status(400).json({ error: "Missing required parameters for adding item" });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    // 1. Fetch categories for safe resequencing bases
    const catSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Categories!A:C" });
    const baseNumbers: Record<string, number> = {};
    (catSearch.data.values || []).slice(1).forEach(row => {
      const catName = (row[0] || "").toString().trim();
      const catBase = parseInt(row[1] || row[2] || "0", 10) || 0;
      if (catName) {
        baseNumbers[catName] = catBase || getCategoryBase(catName);
      }
    });

    // 2. Fetch the current sheet data
    const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Auction-Items!A:L" });
    const values = dataRes.data.values || [];

    if (values.length === 0) {
      values.push([
        "Auction Item ID", "Category", "Item Name", "Description", "Value", 
        "Opening Bid", "Min Raise Amount", "Donated By", 
        "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"
      ]);
    }

    // 3. Construct and append the new item (temporary ID "TEMP")
    const newRow = [
      "TEMP",
      category,
      name,
      description || "",
      value || "",
      openingBid || "",
      minRaise || "",
      donor || "",
      itemType || "",
      "Active",
      "",
      ""
    ];
    values.push(newRow);

    // 4. Run Re-Sequencing Cleanup for the affected category to compute and guarantee correct ID
    const rowMapping: {origIndex: number, row: any[]}[] = [];
    for (let i = 1; i < values.length; i++) {
      const r = values[i] || [];
      if (r[1] === category && r[9] === "Active") {
        rowMapping.push({ origIndex: i, row: r });
      }
    }

    rowMapping.sort((a, b) => {
      const idA = a.row[0] === "TEMP" ? 999999 : (parseInt(a.row[0]) || 999999);
      const idB = b.row[0] === "TEMP" ? 999999 : (parseInt(b.row[0]) || 999999);
      if (idA !== idB) return idA - idB;
      return a.origIndex - b.origIndex;
    });

    const startNum = baseNumbers[category] || getCategoryBase(category);
    let runningNum = startNum;
    rowMapping.forEach(item => {
      item.row[0] = runningNum.toString();
      runningNum++;
    });

    // 5. Update the entire sheet range to persist the new row and correct/gap-free IDs
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Auction-Items!A1:L",
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });

    // Invalidate cache for this spreadsheet
    for (const key of sheetCache.keys()) {
      if (key.startsWith(`${spreadsheetId}:`)) {
        sheetCache.delete(key);
      }
    }

    const assignedId = newRow[0];
    res.json({ success: true, assigned_id: assignedId, rowIndex: values.length });
  } catch (error: any) {
    console.error("[Server Error] add-item:", error);
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

    // 1. Fetch categories for safe resequencing
    const catSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Categories!A:C" });
    const baseNumbers: Record<string, number> = {};
    (catSearch.data.values || []).slice(1).forEach(row => {
      const catName = (row[0] || "").toString().trim();
      const catBase = parseInt(row[1] || row[2] || "0", 10) || 0;
      if (catName) {
        baseNumbers[catName] = catBase || getCategoryBase(catName);
      }
    });

    // 2. Fetch the current sheet data
    const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Auction-Items!A:L" });
    const values = dataRes.data.values || [];

    // 3. Mark the specified item as deleted
    // Ensure the array reaches the requested rowIndex
    if (!values[rowIndex - 1]) {
      throw new Error(`Row ${rowIndex} not found in the spreadsheet.`);
    }

    const row = values[rowIndex - 1];
    const category = row[1]; // Category is in Column B (index 1)

    // Soft delete: clear ID (Column A) and set status to "Deleted" (Column J)
    row[0] = "";
    row[9] = "Deleted";

    // 4. Run Re-Sequencing Cleanup for the affected category
    if (category) {
      const affectedCategories = new Set<string>();
      affectedCategories.add(category);

      for (const cat of affectedCategories) {
        const rowMapping: {origIndex: number, row: any[]}[] = [];
        for (let i = 1; i < values.length; i++) {
          const r = values[i] || [];
          if (r[1] === r[1] && r[1] === cat && r[9] === "Active") {
            rowMapping.push({ origIndex: i, row: r });
          }
        }
        rowMapping.sort((a, b) => {
          const idA = parseInt(a.row[0]) || 999999;
          const idB = parseInt(b.row[0]) || 999999;
          return idA - idB;
        });
        const startNum = baseNumbers[cat] || getCategoryBase(cat);
        let runningNum = startNum;
        rowMapping.forEach(item => { item.row[0] = runningNum.toString(); runningNum++; });
      }
    }

    // 5. Update the spreadsheet with the modified row and any re-sequenced items
    await sheets.spreadsheets.values.update({
      spreadsheetId, 
      range: "Auction-Items!A1:L", 
      valueInputOption: "USER_ENTERED", 
      requestBody: { values }
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("[Server Error] delete-item:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update Auction Item Row & Manage Sequencing on Change
app.post("/api/auction/update-item", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { spreadsheetId, rowIndex, field, value } = req.body;
  if (!spreadsheetId || !rowIndex || !field) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    // 1. Fetch categories for safe resequencing
    const catSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Categories!A:C" });
    const baseNumbers: Record<string, number> = {};
    (catSearch.data.values || []).slice(1).forEach(row => {
      const catName = (row[0] || "").toString().trim();
      const catBase = parseInt(row[1] || row[2] || "0", 10) || 0;
      if (catName) {
        baseNumbers[catName] = catBase || getCategoryBase(catName);
      }
    });

    // 2. Fetch current items
    const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Auction-Items!A:L" });
    const values = dataRes.data.values || [];

    if (!values[rowIndex - 1]) {
      throw new Error(`Row ${rowIndex} not found`);
    }

    const row = values[rowIndex - 1];
    const oldCategory = row[1];

    // Field mapping to index
    const fieldMapping: Record<string, number> = {
      id: 0,
      category: 1,
      name: 2,
      description: 3,
      value: 4,
      openingBid: 5,
      minRaise: 6,
      donor: 7,
      itemType: 8,
      status: 9,
      bundleId: 10,
      bundledDateTime: 11
    };

    const colIdx = fieldMapping[field];
    if (colIdx === undefined) throw new Error(`Invalid field: ${field}`);

    // Update the field
    row[colIdx] = value;

    // Track affected categories for re-sequencing
    const affectedCategories = new Set<string>();
    if (field === 'category') {
      if (oldCategory) affectedCategories.add(oldCategory);
      if (value) affectedCategories.add(value);
    } else if (field === 'status') {
      const category = row[1];
      if (category) affectedCategories.add(category);
    }

    // Run Re-Sequencing Cleanup for affected categories
    for (const cat of affectedCategories) {
      if (!cat) continue;
      const rowMapping: {origIndex: number, row: any[]}[] = [];
      for (let i = 1; i < values.length; i++) {
        const r = values[i] || [];
        if (r[1] === cat && r[9] === "Active") {
          rowMapping.push({ origIndex: i, row: r });
        }
      }
      // Sort them by their original numerical ID or rowIndex if ID is missing / empty
      rowMapping.sort((a, b) => {
        const idA = parseInt(a.row[0]) || 999999;
        const idB = parseInt(b.row[0]) || 999999;
        if (idA !== idB) return idA - idB;
        return a.origIndex - b.origIndex;
      });
      
      const startNum = baseNumbers[cat] || getCategoryBase(cat);
      let runningNum = startNum;
      rowMapping.forEach(item => {
        item.row[0] = runningNum.toString();
        runningNum++;
      });
    }

    // Update the spreadsheet with the modified rows
    await sheets.spreadsheets.values.update({
      spreadsheetId, 
      range: "Auction-Items!A1:L", 
      valueInputOption: "USER_ENTERED", 
      requestBody: { values }
    });

    res.json({ success: true, affected_categories: Array.from(affectedCategories) });
  } catch (error: any) {
    console.error("[Server Error] update-item:", error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk Update Auction Item Rows & Manage Sequencing on Change
app.post("/api/auction/bulk-update-items", async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: "Unauthorized" });

  const { spreadsheetId, rowIndices, field, value } = req.body;
  if (!spreadsheetId || !rowIndices || !rowIndices.length || !field) {
    return res.status(400).json({ error: "Missing required bulk update parameters" });
  }

  try {
    const client = getAuthenticatedClient(req.session.tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    // Fetch categories and base numbers
    const catSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Categories!A:C" });
    const baseNumbers: Record<string, number> = {};
    (catSearch.data.values || []).slice(1).forEach(row => {
      const catName = (row[0] || "").toString().trim();
      const catBase = parseInt(row[1] || row[2] || "0", 10) || 0;
      if (catName) {
        baseNumbers[catName] = catBase || getCategoryBase(catName);
      }
    });

    const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Auction-Items!A:L" });
    const values = dataRes.data.values || [];

    const fieldMapping: Record<string, number> = {
      id: 0,
      category: 1,
      name: 2,
      description: 3,
      value: 4,
      openingBid: 5,
      minRaise: 6,
      donor: 7,
      itemType: 8,
      status: 9,
      bundleId: 10,
      bundledDateTime: 11
    };

    const colIdx = fieldMapping[field];
    if (colIdx === undefined) throw new Error(`Invalid field: ${field}`);

    const affectedCategories = new Set<string>();

    for (const rowIndex of rowIndices) {
      if (!values[rowIndex - 1]) continue;
      const row = values[rowIndex - 1];
      const oldCategory = row[1];
      
      row[colIdx] = value;

      if (field === 'category') {
        if (oldCategory) affectedCategories.add(oldCategory);
        if (value) affectedCategories.add(value);
      } else if (field === 'status') {
        const category = row[1];
        if (category) affectedCategories.add(category);
      }
    }

    // Run Re-Sequencing Cleanup
    for (const cat of affectedCategories) {
      if (!cat) continue;
      const rowMapping: {origIndex: number, row: any[]}[] = [];
      for (let i = 1; i < values.length; i++) {
        const r = values[i] || [];
        if (r[1] === cat && r[9] === "Active") {
          rowMapping.push({ origIndex: i, row: r });
        }
      }
      rowMapping.sort((a, b) => {
        const idA = parseInt(a.row[0]) || 999999;
        const idB = parseInt(b.row[0]) || 999999;
        if (idA !== idB) return idA - idB;
        return a.origIndex - b.origIndex;
      });
      
      const startNum = baseNumbers[cat] || getCategoryBase(cat);
      let runningNum = startNum;
      rowMapping.forEach(item => {
        item.row[0] = runningNum.toString();
        runningNum++;
      });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId, 
      range: "Auction-Items!A1:L", 
      valueInputOption: "USER_ENTERED", 
      requestBody: { values }
    });

    res.json({ success: true, affected_categories: Array.from(affectedCategories) });
  } catch (error: any) {
    console.error("[Server Error] bulk-update-items:", error);
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
    if (error.code === 400 || (error.message && error.message.includes("Unable to parse range"))) {
      return res.status(400).json({ error: error.message, isRangeError: true });
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
