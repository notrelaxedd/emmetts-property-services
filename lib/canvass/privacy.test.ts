/**
 * The "no people-search code path" acceptance check: walks every canvass source directory and fails, naming the
 * file and the host / term, for any URL host outside the allowlist or any denylisted site name.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_HOSTS,
  ALLOWED_LINK_HOSTS,
  DENYLIST,
  GUARDED_DIRS,
  auditSource,
  deniedTerms,
  extractHosts,
  isAllowedHost,
  isAllowedHostOrLink,
  normalizeHost,
} from "./privacy";

const ROOT = path.resolve(__dirname, "..", "..");
/** The guard itself holds the denylist, so it (and this test) are the only files skipped. */
const SELF = new Set(["privacy.ts", "privacy.test.ts"]);
const SKIP_DIRS = new Set(["node_modules", ".next"]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
    } else if (/\.tsx?$/.test(name) && !SELF.has(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("privacy allowlist", () => {
  it("lists exactly the hosts the spec allows (plus loopback / example names for tests)", () => {
    expect([...ALLOWED_HOSTS].sort()).toEqual(
      [
        "gis.cuyahogacounty.gov",
        "api.census.gov",
        "tigerweb.geo.census.gov",
        "geocoding.geo.census.gov",
        "api.open-meteo.com",
        "server.arcgisonline.com",
        "tile.openstreetmap.org",
        "api.anthropic.com",
        "localhost",
        "127.0.0.1",
        "example.com",
        "example.invalid",
      ].sort(),
    );
    for (const h of ALLOWED_LINK_HOSTS) expect(ALLOWED_HOSTS).not.toContain(h);
  });

  it("extracts and normalizes hosts", () => {
    const src = `
      const a = "https://API.Census.gov/data/2023/acs/acs5";
      const b = 'http://localhost:3000/quote';
      const c = \`https://gis.cuyahogacounty.gov/server/rest/services/\${layer}\`;
      const d = "https://api.census.gov/data/key_signup.html";
    `;
    expect(extractHosts(src)).toEqual(["api.census.gov", "localhost", "gis.cuyahogacounty.gov"]);
    expect(normalizeHost(" Example.COM. ")).toBe("example.com");
    expect(extractHosts("no urls here")).toEqual([]);
  });

  it("accepts allowed hosts and rejects everything else", () => {
    expect(isAllowedHost("api.open-meteo.com")).toBe(true);
    expect(isAllowedHost("API.OPEN-METEO.COM")).toBe(true);
    expect(isAllowedHost("evil.api.open-meteo.com")).toBe(false);
    expect(isAllowedHost("api.open-meteo.com.evil.net")).toBe(false);
    expect(isAllowedHost("www.openstreetmap.org")).toBe(false);
    expect(isAllowedHostOrLink("www.openstreetmap.org")).toBe(true);
    expect(isAllowedHostOrLink("unpkg.com")).toBe(false);
  });

  it("finds denylisted terms case-insensitively", () => {
    const [first] = DENYLIST;
    expect(deniedTerms(`fetch("https://www.${first}.com/in/someone")`)).toEqual([first]);
    expect(deniedTerms(`// ${first.toUpperCase()}`)).toEqual([first]);
    expect(deniedTerms("fetch('https://api.census.gov')")).toEqual([]);
    expect(DENYLIST).toHaveLength(9);
  });

  it("reports every violation in a file", () => {
    const [, second] = DENYLIST;
    const src = `fetch("https://people.${second}.example.net/x"); fetch("https://api.census.gov/y"); <a href="https://www.openstreetmap.org/copyright">`;
    expect(auditSource("x.ts", src)).toEqual([
      { file: "x.ts", kind: "host", detail: `people.${second}.example.net` },
      { file: "x.ts", kind: "denylist", detail: second },
    ]);
    expect(auditSource("y.ts", "const u = 'https://api.census.gov'")).toEqual([]);
  });
});

describe("canvass source directories", () => {
  const files = GUARDED_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));

  it("walks at least the lib/canvass modules", () => {
    expect(files.some((f) => f.endsWith(path.join("lib", "canvass", "quote.ts")))).toBe(true);
  });

  it("only reach allowed hosts and never mention a people-search, broker or social site", () => {
    const violations = files.flatMap((file) => auditSource(path.relative(ROOT, file), readFileSync(file, "utf8")));
    const report = violations.map((v) => `${v.file}: ${v.kind} "${v.detail}"`);
    expect(report).toEqual([]);
  });
});
