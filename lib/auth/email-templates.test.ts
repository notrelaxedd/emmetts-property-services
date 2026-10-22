import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_EMAIL_TEMPLATES, buildAuthConfigPatch, checkTemplate, projectRefFromUrl, templateVariables } from "./email-templates";

const DIR = path.resolve(__dirname, "../../supabase/templates");
const read = (name: string) => readFileSync(path.join(DIR, `${name}.html`), "utf8");

describe("supabase/templates", () => {
  it("has exactly one file per configured template", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, "")).sort();
    expect(files).toEqual(AUTH_EMAIL_TEMPLATES.map((t) => t.name).sort());
  });

  it.each(AUTH_EMAIL_TEMPLATES.map((t) => [t.name, t] as const))("%s passes the template checks", (_name, t) => {
    expect(checkTemplate(t, read(t.name))).toEqual([]);
  });

  it("link emails put the confirmation URL in a link, not just in text", () => {
    for (const t of AUTH_EMAIL_TEMPLATES.filter((t) => t.requires.includes("ConfirmationURL"))) {
      expect(read(t.name), t.name).toContain('href="{{ .ConfirmationURL }}"');
    }
  });
});

describe("checkTemplate", () => {
  const t = AUTH_EMAIL_TEMPLATES.find((x) => x.name === "magic_link")!;

  it("flags a missing required variable", () => {
    expect(checkTemplate(t, "<p>hi</p>")).toEqual(["magic_link: missing {{ .ConfirmationURL }}"]);
  });

  it("flags NewEmail outside the change-email template and an unclosed if", () => {
    const html = '<a href="{{ .ConfirmationURL }}">x</a> {{ .NewEmail }} {{ if .Data.name }}hi';
    expect(checkTemplate(t, html)).toEqual([
      "magic_link: {{ .NewEmail }} is only set in email_change",
      "magic_link: 1 {{ if }} but 0 {{ end }}",
    ]);
  });

  it("reads variables inside if blocks", () => {
    expect(Array.from(templateVariables("{{ if .Data.name }}{{ .Data.name }}{{ end }} {{ .Token }}")).sort()).toEqual(["Data", "Token"]);
  });
});

describe("buildAuthConfigPatch", () => {
  it("uses the Management API key names and turns on the notification", () => {
    const body = buildAuthConfigPatch((name) => `<p>${name}</p>`);
    expect(body.mailer_subjects_invite).toBe("You're invited to the Emmett's crew app");
    expect(body.mailer_templates_invite_content).toBe("<p>invite</p>");
    expect(body.mailer_templates_reauthentication_content).toBe("<p>reauthentication</p>");
    expect(body.mailer_templates_password_changed_notification_content).toBe("<p>password_changed_notification</p>");
    expect(body.mailer_notifications_password_changed_enabled).toBe(true);
    expect(Object.keys(body)).toHaveLength(AUTH_EMAIL_TEMPLATES.length * 2 + 1);
  });
});

describe("projectRefFromUrl", () => {
  it("pulls the ref out of a supabase.co URL", () => {
    expect(projectRefFromUrl("https://abcdefghijklmnopqrst.supabase.co")).toBe("abcdefghijklmnopqrst");
    expect(projectRefFromUrl("https://auth.example.com")).toBeNull();
    expect(projectRefFromUrl("not a url")).toBeNull();
    expect(projectRefFromUrl(undefined)).toBeNull();
  });
});
