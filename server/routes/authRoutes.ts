import { Router } from 'express';
import crypto from 'crypto';
import { google } from 'googleapis';
import { getOAuthClient, SCOPES } from '../services/oauth';
import { persistSweeperCredential } from '../services/paypalSweeperJob';
import { getRole, normalizeEmail, recordLogin } from '../services/userService';
import { capabilitiesFor, ROLE_LABELS } from '../utils/permissions';
import { setVolunteerCredential, volunteerAccountEmail } from '../services/volunteerService';
import { volunteerAccessEnded, VOLUNTEER_ACCESS_ENDED } from '../middleware/requireAuth';

const router = Router();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

const ORG_DOMAIN = "orns.org";

/** Constant-time string comparison (both values are ours or the query's - never logged). */
function sameState(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

router.get("/auth/url", (req, res, next) => {
  try {
    const client = getOAuthClient(req);
    // A one-time `state` tied to this browser's session cookie
    // (ROADMAP.md M2): the callback only accepts a code that comes back
    // with it, so a link someone else started can't sign this browser
    // into their account (login CSRF).
    const state = crypto.randomBytes(24).toString("base64url");
    req.session!.oauthState = state;
    const url = client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "select_account consent",
      hd: ORG_DOMAIN,
      state,
    });
    res.json({ url });
  } catch (error) {
    next(error);
  }
});

router.get("/auth/callback", async (req, res, next) => {
  const { code, state } = req.query;
  const expectedState = req.session?.oauthState;
  const purpose = req.session?.oauthPurpose;
  if (req.session) {
    delete req.session.oauthState;
    delete req.session.oauthPurpose;
  }
  if (!sameState(state, expectedState)) {
    return res.status(403).send(`<html><body>This sign-in link has expired or was started in another browser. <a href="/">Return to the app</a> and sign in again.</body></html>`);
  }
  try {
    const client = getOAuthClient(req);
    const { tokens } = await client.getToken(code as string);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email || "";

    // `hd` is the account's Google Workspace domain - unlike the email
    // suffix, a personal Google account can't claim it.
    if (!email.endsWith(`@${ORG_DOMAIN}`) || userInfo.data.hd !== ORG_DOMAIN || userInfo.data.verified_email === false) {
      return res.status(403).send(`<html><body>Access Denied: @orns.org required.</body></html>`);
    }
    // A Full Administrator connecting the shared volunteer account (started
    // at /auth/volunteer-account/connect): keep that account's sign-in for
    // volunteers, and leave the admin's own session exactly as it was.
    if (purpose === "volunteer-account") {
      if (normalizeEmail(email) !== volunteerAccountEmail()) {
        return res.status(403).send(`<html><body>That was ${escapeHtml(email)}. Sign in as ${escapeHtml(volunteerAccountEmail())} to connect volunteer access. <a href="/Settings">Back to Settings</a></body></html>`);
      }
      if (!tokens.refresh_token) {
        return res.status(400).send(`<html><body>Google didn't return a lasting sign-in for ${escapeHtml(email)}. <a href="/auth/volunteer-account/connect">Try again</a>.</body></html>`);
      }
      await setVolunteerCredential(tokens.refresh_token, req.session?.email || "unknown");
      return res.send(`<!DOCTYPE html><html><body style="font-family: sans-serif; text-align: center; padding-top: 80px;">
        <p>Connected ${escapeHtml(email)} for volunteers. Returning to Settings...</p>
        <script>window.location.href = '/Settings';</script></body></html>`);
    }

    // The shared volunteer account is a robot login the server uses for
    // volunteers, not a person - it never signs in to the app itself.
    const volunteerAccount = process.env.VOLUNTEER_GOOGLE_ACCOUNT;
    if (volunteerAccount && normalizeEmail(email) === normalizeEmail(volunteerAccount)) {
      return res.status(403).send(`<html><body>${escapeHtml(email)} is the shared volunteer account and can't sign in to the app directly. <a href="/">Sign in with your own @orns.org account</a>.</body></html>`);
    }

    if (!req.session) {
      req.session = { tokens: null };
    }
    
    const slimTokens = { ...tokens };
    delete slimTokens.id_token;
    delete slimTokens.scope;
    req.session.tokens = slimTokens;
    req.session.email = normalizeEmail(email);

    // Best-effort, like the sweeper credential below: lets the Users tab
    // list everyone who has signed in. Never blocks or fails the login.
    recordLogin(email).catch((e) => {
      console.error("[Users] Failed to record sign-in:", e);
    });

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

router.get("/auth/status", async (req, res, next) => {
  const volunteer = req.session?.volunteer;
  if (volunteer) {
    try {
      if (await volunteerAccessEnded(volunteer.id)) {
        req.session = null;
        return res.json({ authenticated: false, reason: VOLUNTEER_ACCESS_ENDED });
      }
    } catch (error) {
      // Couldn't check (Google or Firestore unreachable): stay signed in.
      console.warn("[Volunteers] Couldn't check a volunteer's access:", (error as any)?.message || error);
    }
    return res.json({
      authenticated: true,
      user: { email: volunteer.email, role: "volunteer", roleLabel: ROLE_LABELS.volunteer, capabilities: capabilitiesFor("volunteer") },
    });
  }

  const email = req.session?.email;
  // A session from before roles existed has tokens but no email - it
  // counts as signed out, so the person signs in once more.
  if (!req.session?.tokens || !email) {
    return res.json({ authenticated: false });
  }
  try {
    const role = await getRole(email);
    res.json({
      authenticated: true,
      user: { email, role, roleLabel: ROLE_LABELS[role], capabilities: capabilitiesFor(role) },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/logout", (req, res) => {
  req.session = null;
  res.clearCookie('orns_session');
  res.json({ success: true });
});

export default router;
