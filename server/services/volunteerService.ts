import crypto from "crypto";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { getAdminFirestore } from "./firebaseAdmin";
import { getOAuthClient } from "./oauth";
import { normalizeEmail } from "./userService";
import { AuctionState, parseAuctionState } from "../utils/auctionState";

/**
 * Volunteers: people outside @orns.org who get Bid Management access while
 * the auction is Live, through a one-time sign-in link.
 *
 * - Records: Firestore `volunteers/{id}`, server-only. Only a SHA-256 of the
 *   link token is stored.
 * - Google access: volunteers have none of their own, so the server reads
 *   and writes the spreadsheets for them as the shared ORNS account
 *   VOLUNTEER_GOOGLE_ACCOUNT, whose stored sign-in lives in
 *   `system/volunteerAuth` (same pattern as the PayPal sweeper's).
 * - Each volunteer request checks (cached CACHE_TTL_MS) that their record is
 *   still active and the auction is Live, so a Revoke or a Close takes
 *   effect within that time even though sessions are cookies.
 */
const COLLECTION = "volunteers";
const CREDENTIAL = () => getAdminFirestore().collection("system").doc("volunteerAuth");
const CACHE_TTL_MS = 30 * 1000;
const LAST_SEEN_INTERVAL_MS = 60 * 1000;

export type VolunteerStatus = "invited" | "active" | "deactivated" | "revoked";

export interface Volunteer {
  id: string;
  email: string;
  name: string;
  status: VolunteerStatus;
  invitedBy: string;
  invitedAt: string;
  redeemedAt?: string;
  lastSeenAt?: string;
  deactivatedAt?: string;
  deactivatedReason?: string;
}

interface VolunteerDoc extends Omit<Volunteer, "id"> {
  tokenHash: string;
}

const volunteers = () => getAdminFirestore().collection(COLLECTION);

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function toVolunteer(id: string, d: Partial<VolunteerDoc>): Volunteer {
  const { tokenHash: _hash, ...rest } = d;
  return { id, email: "", name: "", status: "invited", invitedBy: "", invitedAt: "", ...rest } as Volunteer;
}

// ---- Records ----------------------------------------------------------

export async function listVolunteers(): Promise<Volunteer[]> {
  const snap = await volunteers().get();
  return snap.docs
    .map((doc) => toVolunteer(doc.id, doc.data() as VolunteerDoc))
    .sort((a, b) => (b.invitedAt || "").localeCompare(a.invitedAt || ""));
}

/**
 * Invites `email` (or re-invites: an existing record for that address is
 * reused). Returns the record and the plain token for the link - the only
 * time the token exists outside the email.
 */
export async function inviteVolunteer(email: string, name: string, invitedBy: string): Promise<{ volunteer: Volunteer; token: string }> {
  const key = normalizeEmail(email);
  const existing = await volunteers().where("email", "==", key).limit(1).get();
  const ref = existing.empty ? volunteers().doc() : existing.docs[0].ref;
  const token = newToken();
  const data: VolunteerDoc = {
    email: key,
    name: name.trim(),
    status: "invited",
    tokenHash: hashToken(token),
    invitedBy: normalizeEmail(invitedBy),
    invitedAt: new Date().toISOString(),
  };
  await ref.set(data);
  statusCache.delete(ref.id);
  return { volunteer: toVolunteer(ref.id, data), token };
}

/** A fresh link for an existing volunteer; the old link stops working. */
export async function resendVolunteerLink(id: string, by: string): Promise<{ volunteer: Volunteer; token: string } | null> {
  const ref = volunteers().doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const token = newToken();
  const update = { status: "invited" as const, tokenHash: hashToken(token), invitedBy: normalizeEmail(by), invitedAt: new Date().toISOString() };
  await ref.set(update, { merge: true });
  statusCache.delete(id);
  return { volunteer: toVolunteer(id, { ...(snap.data() as VolunteerDoc), ...update }), token };
}

export async function revokeVolunteer(id: string): Promise<boolean> {
  const ref = volunteers().doc(id);
  if (!(await ref.get()).exists) return false;
  await ref.set({ status: "revoked", tokenHash: "", deactivatedAt: new Date().toISOString(), deactivatedReason: "revoked" }, { merge: true });
  statusCache.delete(id);
  return true;
}

/** Ends every invited or active volunteer's access (the auction closed). Returns how many. */
export async function deactivateAllVolunteers(reason: string): Promise<number> {
  const snap = await volunteers().where("status", "in", ["invited", "active"]).get();
  const at = new Date().toISOString();
  await Promise.all(snap.docs.map((doc) => doc.ref.set({ status: "deactivated", tokenHash: "", deactivatedAt: at, deactivatedReason: reason }, { merge: true })));
  statusCache.clear();
  return snap.size;
}

/** Removes revoked and deactivated records (tidying up before the next auction). Returns how many. */
export async function clearEndedVolunteers(): Promise<number> {
  const snap = await volunteers().where("status", "in", ["deactivated", "revoked"]).get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  return snap.size;
}

// ---- One-time link ------------------------------------------------------

export async function findVolunteerByToken(token: string): Promise<Volunteer | null> {
  if (!token) return null;
  const snap = await volunteers().where("tokenHash", "==", hashToken(token)).limit(1).get();
  if (snap.empty) return null;
  return toVolunteer(snap.docs[0].id, snap.docs[0].data() as VolunteerDoc);
}

/** Uses up the link: the record becomes active and the token is forgotten. */
export async function redeemVolunteer(id: string): Promise<void> {
  const now = new Date().toISOString();
  await volunteers().doc(id).set({ status: "active", tokenHash: "", redeemedAt: now, lastSeenAt: now }, { merge: true });
  statusCache.delete(id);
}

// ---- Per-request checks -----------------------------------------------

const statusCache = new Map<string, { status: VolunteerStatus | null; readAt: number }>();
const lastSeenWritten = new Map<string, number>();

/** The volunteer's current status (null if the record is gone), cached CACHE_TTL_MS. */
export async function getVolunteerStatus(id: string, now = Date.now()): Promise<VolunteerStatus | null> {
  const hit = statusCache.get(id);
  if (hit && now - hit.readAt < CACHE_TTL_MS) return hit.status;
  const snap = await volunteers().doc(id).get();
  const status = snap.exists ? ((snap.data() as VolunteerDoc).status ?? null) : null;
  statusCache.set(id, { status, readAt: now });
  return status;
}

/** Records that a volunteer is using the app, at most once a minute. Best-effort. */
export function touchVolunteer(id: string, now = Date.now()): void {
  if (now - (lastSeenWritten.get(id) || 0) < LAST_SEEN_INTERVAL_MS) return;
  lastSeenWritten.set(id, now);
  volunteers().doc(id).set({ lastSeenAt: new Date(now).toISOString() }, { merge: true }).catch((e) => {
    console.warn("[Volunteers] Couldn't record last seen:", e?.message || e);
  });
}

// ---- The shared volunteer Google account ------------------------------

export interface VolunteerAccountStatus {
  connected: boolean;
  email: string;
  connectedBy?: string;
  connectedAt?: string;
}

export function volunteerAccountEmail(): string {
  return normalizeEmail(process.env.VOLUNTEER_GOOGLE_ACCOUNT || "");
}

export async function setVolunteerCredential(refreshToken: string, connectedBy: string): Promise<void> {
  await CREDENTIAL().set({ refreshToken, email: volunteerAccountEmail(), connectedBy: normalizeEmail(connectedBy), connectedAt: new Date().toISOString() });
  cachedClient = null;
}

export async function getVolunteerAccountStatus(): Promise<VolunteerAccountStatus> {
  const d = (await CREDENTIAL().get()).data();
  return { connected: !!d?.refreshToken, email: d?.email || volunteerAccountEmail(), connectedBy: d?.connectedBy, connectedAt: d?.connectedAt };
}

let cachedClient: { client: OAuth2Client; readAt: number } | null = null;

/** A Google client acting as the shared volunteer account, or null if it isn't connected. */
export async function getVolunteerAuthClient(now = Date.now()): Promise<OAuth2Client | null> {
  if (cachedClient && now - cachedClient.readAt < CACHE_TTL_MS) return cachedClient.client;
  const refreshToken = (await CREDENTIAL().get()).data()?.refreshToken;
  if (!refreshToken) return null;
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  cachedClient = { client, readAt: now };
  return client;
}

// ---- Shared Config, read for volunteers ---------------------------------

export interface RuntimeConfig {
  auctionItemsSpreadsheetId: string;
  auctionTicketsSpreadsheetId: string;
  bidManagementSpreadsheetId: string;
  bidderNumbersSheet: string;
  bidManagementSheet: string;
  receiptFolderId: string;
  forPrintFolderId: string;
  ticketPrice: string;
  paypalIsSandbox: boolean;
}

let cachedConfig: { config: RuntimeConfig; readAt: number } | null = null;

/** The Config fields the Bid Management page needs (volunteers can't read Firestore themselves). */
export async function getRuntimeConfig(now = Date.now()): Promise<RuntimeConfig> {
  if (cachedConfig && now - cachedConfig.readAt < CACHE_TTL_MS) return cachedConfig.config;
  const d = (await getAdminFirestore().collection("settings").doc("global").get()).data() || {};
  const config: RuntimeConfig = {
    auctionItemsSpreadsheetId: d.auctionItemsSpreadsheetId || "",
    auctionTicketsSpreadsheetId: d.auctionTicketsSpreadsheetId || "",
    bidManagementSpreadsheetId: d.bidManagementSpreadsheetId || "",
    bidderNumbersSheet: d.bidderNumbersSheet || "Bidder-Numbers",
    bidManagementSheet: d.bidManagementSheet || "Bid-Management",
    receiptFolderId: d.receiptFolderId || "",
    forPrintFolderId: d.forPrintFolderId || "",
    ticketPrice: d.ticketPrice || "",
    paypalIsSandbox: d.paypalIsSandbox !== false,
  };
  cachedConfig = { config, readAt: now };
  return config;
}

let cachedState: { state: AuctionState; readAt: number } | null = null;

/** The auction's state, read as the volunteer account (cached CACHE_TTL_MS). Throws if it can't be read. */
export async function getAuctionStateForVolunteers(now = Date.now()): Promise<AuctionState> {
  if (cachedState && now - cachedState.readAt < CACHE_TTL_MS) return cachedState.state;
  const client = await getVolunteerAuthClient(now);
  if (!client) throw new Error("The volunteer Google account isn't connected.");
  const { bidManagementSpreadsheetId } = await getRuntimeConfig(now);
  if (!bidManagementSpreadsheetId) throw new Error("No Bid Management spreadsheet is configured.");
  const res = await google.sheets({ version: "v4", auth: client }).spreadsheets.values.get({
    spreadsheetId: bidManagementSpreadsheetId,
    range: "'Auction-Status'!A2",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const state = parseAuctionState(res.data.values?.[0]?.[0]);
  cachedState = { state, readAt: now };
  return state;
}

/** Forget the cached auction state (after Go Live / Close in this process). */
export function forgetAuctionState(): void {
  cachedState = null;
}

/** Test-only. */
export function _resetVolunteerCachesForTesting(): void {
  statusCache.clear();
  lastSeenWritten.clear();
  cachedClient = null;
  cachedConfig = null;
  cachedState = null;
}
