import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getOAuthClient } from "../services/oauth";

/**
 * getOAuthClient builds the OAuth redirect_uri from APP_URL alone, never
 * from the request - Host/X-Forwarded-Host/X-Forwarded-Proto are
 * client-supplied and, on Cloud Run, forwarded to the container largely
 * as the client sent them, so trusting them would let a request forge
 * the redirect_uri embedded in the Google consent URL. These tests pass a
 * request carrying attacker-controlled forwarded headers and assert they
 * have no effect on the resulting redirect_uri.
 */
describe("getOAuthClient", () => {
  const originalAppUrl = process.env.APP_URL;

  beforeEach(() => {
    process.env.APP_URL = "https://auction.orns.org";
  });

  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = originalAppUrl;
    }
  });

  function fakeReqWithForwardedHeaders(headers: Record<string, string>) {
    return {
      get: (name: string) => headers[name.toLowerCase()],
      protocol: "http",
    } as any;
  }

  it("ignores a forged X-Forwarded-Host/X-Forwarded-Proto and uses APP_URL", () => {
    const maliciousReq = fakeReqWithForwardedHeaders({
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "http",
      host: "attacker.example",
    });

    const client = getOAuthClient(maliciousReq);

    expect((client as any).redirectUri).toBe("https://auction.orns.org/auth/callback");
  });

  it("builds the same redirect_uri whether or not a request is passed", () => {
    const withReq = getOAuthClient(fakeReqWithForwardedHeaders({ "x-forwarded-host": "attacker.example" }));
    const withoutReq = getOAuthClient();

    expect((withReq as any).redirectUri).toBe((withoutReq as any).redirectUri);
  });

  it("upgrades a Cloud Run APP_URL to https even if misconfigured as http", () => {
    process.env.APP_URL = "http://my-service-abc123.run.app";

    const client = getOAuthClient();

    expect((client as any).redirectUri).toBe("https://my-service-abc123.run.app/auth/callback");
  });

  it("upgrades an ai.studio APP_URL to https and sets the callback path", () => {
    process.env.APP_URL = "https://orns-auction-manager.ai.studio";

    const client = getOAuthClient();

    expect((client as any).redirectUri).toBe("https://orns-auction-manager.ai.studio/auth/callback");
  });


  it("adds https protocol to an APP_URL configured without scheme", () => {
    process.env.APP_URL = "orns-auction-manager-37624994705.us-east1.run.app";

    const client = getOAuthClient();

    expect((client as any).redirectUri).toBe("https://orns-auction-manager-37624994705.us-east1.run.app/auth/callback");
  });

  it("trims whitespace around GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET", () => {
    const origId = process.env.GOOGLE_CLIENT_ID;
    const origSecret = process.env.GOOGLE_CLIENT_SECRET;
    try {
      process.env.GOOGLE_CLIENT_ID = "  test-client-id  ";
      process.env.GOOGLE_CLIENT_SECRET = "  test-client-secret\n";

      const client = getOAuthClient();

      expect((client as any)._clientId).toBe("test-client-id");
      expect((client as any)._clientSecret).toBe("test-client-secret");
    } finally {
      process.env.GOOGLE_CLIENT_ID = origId;
      process.env.GOOGLE_CLIENT_SECRET = origSecret;
    }
  });

  it("falls back to localhost when APP_URL is unset", () => {
    delete process.env.APP_URL;

    const client = getOAuthClient();

    expect((client as any).redirectUri).toBe("http://localhost:3000/auth/callback");
  });
});

