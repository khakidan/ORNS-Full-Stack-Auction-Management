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

export const getOAuthClient = (req?: express.Request) => {
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

export function getAuthenticatedClient(tokens: any) {
  const client = getOAuthClient();
  client.setCredentials(tokens);
  return client;
}
