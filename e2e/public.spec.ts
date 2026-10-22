import { expect, test } from "@playwright/test";

/** The marketing site must keep working unchanged, and the new public pages must render with no backend. */
test.describe("public site", () => {
  test("home page funnels to the quote form and still offers a phone number", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Emmett/i);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The hero's main button goes to the quote form; service shortcuts pre-tick a service.
    await expect(page.locator("#main").getByRole("link", { name: /get my free quote/i }).first()).toHaveAttribute("href", "/quote");
    await expect(page.locator('#main a[href="/quote?service=lawn-mowing"]').first()).toBeVisible();
    // Calling is quieter now, but a number is always visible.
    await expect(page.locator('a[href^="tel:+14408235545"]:visible').first()).toBeVisible();
    for (const id of ["how-it-works", "services", "why-us", "contact"]) await expect(page.locator(`#${id}`)).toBeVisible();
  });

  test("/contact renders with an h1 and /book still redirects there", async ({ page }) => {
    const res = await page.goto("/book");
    expect(res?.url()).toContain("/contact");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("/quote renders the form with services and consent boxes", async ({ page }) => {
    await page.goto("/quote?service=lawn-mowing");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('input[name="services"]').first()).toBeVisible();
    await expect(page.locator('input[name="services"][value="lawn-mowing"]')).toBeChecked();
    await expect(page.locator('textarea[name="customRequest"]')).toBeVisible();
    await expect(page.locator('input[name="emailOptIn"]')).toBeVisible();
    await expect(page.locator('input[name="snowList"]')).toBeVisible();
    // Honeypot is present but off-screen, hidden from assistive tech and out of the tab order.
    const honeypot = page.locator('input[name="company"]');
    await expect(honeypot).toHaveAttribute("tabindex", "-1");
    await expect(page.locator('[aria-hidden="true"] input[name="company"]')).toHaveCount(1);
    expect((await honeypot.boundingBox())?.x ?? 0).toBeLessThan(0);
  });

  test("/quote validates required fields client-side without a backend", async ({ page }) => {
    await page.goto("/quote");
    await page.getByRole("button", { name: /quote/i }).last().click();
    await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
    await expect(page).toHaveURL(/\/quote/);
  });

  test("/quote/thanks, /quote/paid, /quote/expired and /unsubscribe render", async ({ page }) => {
    for (const path of ["/quote/thanks", "/quote/paid", "/quote/expired", "/unsubscribe?token=nope"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });

  test("/admin and /crew are gated; /login renders both sign-in methods", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
    await page.goto("/crew/hours");
    await expect(page).toHaveURL(/\/login\?next=%2Fcrew%2Fhours/);
    await expect(page.getByRole("tab", { name: /email/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /phone/i })).toBeVisible();
  });

  test("robots, sitemap and the crew PWA manifest are served", async ({ request }) => {
    expect((await request.get("/robots.txt")).status()).toBe(200);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/quote");
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.start_url).toBe("/crew");
  });
});
