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

    // Bridges the tokens back to the main app window when this callback
    // ran inside the OAuth popup useGoogleAuth.ts opens for the
    // iframe/AI-Studio login path - the iframe can't read this popup's
    // own orns_session cookie directly (third-party cookie restrictions
    // apply to the iframe, not to the popup, which is its own top-level
    // browsing context), so without this bridge the tokens never reach
    // the iframe and login silently loops back to the sign-in screen. A
    // sender here did exactly this historically but was lost in a
    // server.ts refactor (git history: 8211cdc) - useApiAuthStatus.ts's
    // listener has been carrying dead code ever since. Restored with an
    // explicit targetOrigin: the original posted to '*', which would
    // hand a live Google token to any window.opener, not just this app's
    // own window - a malicious page opening a popup at this same
    // /auth/callback URL with window.name 'oauth_popup' could otherwise
    // harvest another user's tokens via this exact bridge.
    const tokensJson = JSON.stringify(slimTokens).replace(/</g, "\\u003c");
    res.send(`<!DOCTYPE html>
<html>
  <body style="font-family: sans-serif; text-align: center; padding-top: 80px; color: #1e293b;">
    <p>Signed in as ${escapeHtml(email)}. This window should close automatically.</p>
    <script>
      (function () {
        var tokens = ${tokensJson};
        var isPopup = false;
        try { isPopup = window.name === 'oauth_popup' && !!window.opener && window.opener !== window; } catch (e) {}

        if (isPopup) {
          try {
            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', tokens: tokens }, window.location.origin);
          } catch (e) {}
          setTimeout(function () { window.close(); }, 500);
          return;
        }

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
