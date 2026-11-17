import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { actionRequestRow, logActionRequest } from "./action-requests";

function req(headers: Record<string, string>, path = "/quote") {
  return new NextRequest(`https://example.com${path}`, { method: "POST", headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("action request log", () => {
  it("captures IP, browser, location, page and action id", () => {
    const row = actionRequestRow(
      req({
        "next-action": "4de453dacdd73f1b492df8fefeb3173116369670",
        "x-forwarded-for": "198.51.100.7, 10.0.0.1",
        "user-agent": "curl/8.0",
        referer: "https://example.com/quote",
        "x-vercel-ip-country": "US",
        "x-vercel-ip-country-region": "OH",
        "x-vercel-ip-city": "Rocky%20River",
      }),
    );
    expect(row).toEqual({
      path: "/quote",
      action_id: "4de453dacdd73f1b492df8fefeb3173116369670",
      ip: "198.51.100.7",
      user_agent: "curl/8.0",
      referer: "https://example.com/quote",
      country: "US",
      region: "OH",
      city: "Rocky River",
    });
  });

  it("posts the row to Supabase and never throws", async () => {
    vi.stubEnv("SUPABASE_URL", "https://db.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await logActionRequest(req({ "next-action": "abc", "x-forwarded-for": "198.51.100.8" }));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://db.example/rest/v1/action_requests");
    expect(JSON.parse(String(init.body))).toMatchObject({ ip: "198.51.100.8", action_id: "abc" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(logActionRequest(req({ "next-action": "abc", "x-forwarded-for": "198.51.100.9" }))).resolves.toBeUndefined();
  });
});
