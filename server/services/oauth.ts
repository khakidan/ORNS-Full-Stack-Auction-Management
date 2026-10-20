import express from "express";
import { google } from "googleapis";

export const SCOPES = [
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

/**
 * `req` is accepted for backward compatibility with callers but is never
 * used to build the redirect URI: the Host/X-Forwarded-Host/
 * X-Forwarded-Proto headers it carries are client-supplied and, on Cloud
 * Run in particular, forwarded to the container largely as the client
 * sent them - trusting them here would let a request forge the
 * redirect_uri embedded in the Google consent URL. APP_URL is the one
 * value an operator sets to match the OAuth client's registered
 * Authorized redirect URI (see docs/agents/README.md), so it's the only
 * source of truth for this, in every environment.
 */
export const getOAuthClient = (_req?: express.Request) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing from environment. Please check the Secrets panel in AI Studio.");
  }

  let baseUrl = process.env.APP_URL?.trim() || "http://localhost:3000";
  if (!/^https?:\/\//i.test(baseUrl)) {
    baseUrl = `https://${baseUrl}`;
  }
  if ((baseUrl.includes("run.app") || baseUrl.includes("ais-") || baseUrl.includes("orns.org") || baseUrl.includes("ai.studio")) && baseUrl.startsWith("http:")) {
    baseUrl = baseUrl.replace("http:", "https:");
  }

  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  const redirectUri = `${cleanBaseUrl}/auth/callback`;

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

export function getAuthenticatedClient(tokens: any) {
  const client = getOAuthClient();
  client.setCredentials(tokens);
  return client;
}
