import { Router } from 'express';
import { google } from 'googleapis';
import { getOAuthClient, SCOPES } from '../services/oauth';
import { persistSweeperCredential } from '../services/paypalSweeperJob';

const router = Router();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

router.post("/log", (req, res) => {
  console.log(`[CLIENT LOG] ${new Date().toISOString()}:`, JSON.stringify(req.body, null, 2));
  res.status(200).end();
});

router.get("/auth/url", (req, res, next) => {
  try {
    const client = getOAuthClient(req);
    const url = client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "select_account consent",
      hd: "orns.org",
    });
    res.json({ url });
  } catch (error) {
    next(error);
  }
});

router.get("/auth/callback", async (req, res, next) => {
  const { code } = req.query;
  try {
    const client = getOAuthClient(req);
    const { tokens } = await client.getToken(code as string);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email || "";

    if (!email.endsWith("@orns.org")) {
      return res.status(403).send(`<html><body>Access Denied: @orns.org required.</body></html>`);
    }

    if (!req.session) {
      req.session = { tokens: null };
    }
    
    const slimTokens = { ...tokens };
    delete slimTokens.id_token;
    delete slimTokens.scope;
    req.session.tokens = slimTokens;

    // Best-effort: persist this login's refresh token as the credential
    // the PayPal sweeper background job (Code Hardening item #2, Step 4)
    // authenticates with, since that job runs on a timer with no session
    // of its own. Never blocks or fails the actual login.
    if (tokens.refresh_token) {
      persistSweeperCredential(tokens.refresh_token, email).catch((e) => {
        console.error("[Sweeper] Failed to persist background-sync credential:", e);
      });
    }

    // The session cookie set above is the only place the tokens go - they
    // are never written into this page. (When the app ran inside AI
    // Studio's iframe, this page also posted the tokens to the opener
    // window for the client to keep in localStorage; the app is now
    // always a top-level page, so the cookie alone is enough.) The inline
    // script only returns the user to the page they signed in from, which
    // useGoogleAuth.ts saved in sessionStorage before redirecting here.
    res.send(`<!DOCTYPE html>
<html>
  <body style="font-family: sans-serif; text-align: center; padding-top: 80px; color: #1e293b;">
    <p>Signed in as ${escapeHtml(email)}. Returning to the app...</p>
    <script>
      (function () {
        var redirectPath = '/';
        try {
          var savedPath = sessionStorage.getItem('post_auth_redirect_path');
          if (savedPath && savedPath.charAt(0) === '/') {
            redirectPath = savedPath;
            sessionStorage.removeItem('post_auth_redirect_path');
          }
        } catch (e) {}
        window.location.href = redirectPath;
      })();
    </script>
  </body>
</html>`);
  } catch (error) {
    next(error);
  }
});

router.get("/auth/status", (req, res) => {
  res.json({ authenticated: req.session && !!req.session.tokens });
});

router.post("/auth/logout", (req, res) => {
  req.session = null;
  res.clearCookie('orns_session');
  res.json({ success: true });
});

export default router;
