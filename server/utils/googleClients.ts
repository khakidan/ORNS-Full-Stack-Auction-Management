import { Request, Response } from "express";
import { google, sheets_v4, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { getAuthenticatedClient } from "../services/oauth";

/**
 * The Google identity a request acts as: the signed-in staff member's own
 * sign-in, or - for a volunteer, who has none - the shared volunteer
 * account requireAuth attached.
 */
export function googleAuthFor(req: Request): OAuth2Client {
  return req.googleAuth ?? getAuthenticatedClient(req.session?.tokens);
}

/** A Sheets client acting as whoever sent `req` (see googleAuthFor). */
export function sheetsFor(req: Request): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: googleAuthFor(req) });
}

/** A Drive client acting as whoever sent `req` (see googleAuthFor). */
export function driveFor(req: Request): drive_v3.Drive {
  return google.drive({ version: "v3", auth: googleAuthFor(req) });
}

export const SPREADSHEET_NOT_FOUND = "Spreadsheet not found. Please check the Spreadsheet ID in Settings.";

/**
 * Answers 404 with `message` when Google said the file doesn't exist
 * (usually a wrong ID in Settings). Returns whether it answered, so a
 * route's catch can fall through to next(error) otherwise.
 */
export function respondIfNotFound(error: any, res: Response, message = SPREADSHEET_NOT_FOUND): boolean {
  if (error?.code !== 404) return false;
  res.status(404).json({ error: message });
  return true;
}
