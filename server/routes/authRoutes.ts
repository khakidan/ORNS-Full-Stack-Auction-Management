import { Router } from 'express';
import { google } from 'googleapis';
import { getOAuthClient, SCOPES } from '../services/oauth';

const router = Router();

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
    
    if (req.session) {
      const slimTokens = { ...tokens };
      delete slimTokens.id_token;
      delete slimTokens.scope;
      req.session.tokens = slimTokens;
    }
    
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

router.get("/auth/status", (req, res) => {
  res.json({ authenticated: req.session && !!req.session.tokens });
});

router.post("/auth/logout", (req, res) => {
  req.session = null;
  res.clearCookie('__session');
  res.json({ success: true });
});

export default router;
