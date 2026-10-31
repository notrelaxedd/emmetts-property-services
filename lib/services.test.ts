import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getService, groupServices, serviceGroups, services, serviceSlugs } from "./services";

/** Slugs inserted into public.services by any migration: the `('slug', 'Name', ...)` rows. */
function seededSlugs(): Set<string> {
  const dir = join(__dirname, "..", "supabase", "migrations");
  const out = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const insert of Array.from(sql.matchAll(/insert into public\.services[\s\S]*?on conflict/g))) {
      for (const row of Array.from(insert[0].matchAll(/\(\s*'([a-z0-9-]+)'\s*,\s*'/g))) out.add(row[1]);
    }
  }
  return out;
}

describe("services", () => {
  it("has unique slugs in the database's slug format", () => {
    expect(new Set(serviceSlugs).size).toBe(services.length);
    for (const slug of serviceSlugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("every site service has a row in the database migrations (same slug)", () => {
    const seeded = seededSlugs();
    for (const slug of serviceSlugs) expect(seeded, `${slug} needs an insert in supabase/migrations/`).toContain(slug);
  });

  it("lists everything the owner asked for", () => {
    for (const slug of [
      "pressure-washing",
      "junk-removal",
      "shrub-removal",
      "tree-trimming",
      "mulching",
      "edging",
      "weeding",
      "bush-trimming",
    ]) {
      expect(getService(slug), slug).toBeDefined();
    }
  });

  it("puts every service in a known group", () => {
    const known = new Set(serviceGroups.map((g) => g.slug));
    for (const s of services) expect(known, `${s.slug} group "${s.group}"`).toContain(s.group);
  });

  it("groups in page order, keeps list order inside a group, and can leave out the featured one", () => {
    const grouped = groupServices(services, "fall-cleanup");
    expect(grouped.map((g) => g.group?.slug)).toEqual(["lawn", "beds", "seasonal", "exterior"]);
    expect(grouped.flatMap((g) => g.services.map((s) => s.slug))).not.toContain("fall-cleanup");
    const seasonal = grouped.find((g) => g.group?.slug === "seasonal")!.services.map((s) => s.slug);
    expect(seasonal).toEqual(["leaf-removal", "gutter-cleaning", "snow-removal"]);
    expect(grouped.flatMap((g) => g.services)).toHaveLength(services.length - 1);
  });

  it("lists database-only services (no site group) last, under no heading", () => {
    const grouped = groupServices([
      { slug: "owner-added", name: "Owner added" },
      { slug: "mulching", name: "Mulching", group: "beds" as const },
    ]);
    expect(grouped.map((g) => g.group?.slug ?? null)).toEqual(["beds", null]);
    expect(grouped[1].services[0].slug).toBe("owner-added");
  });
});
