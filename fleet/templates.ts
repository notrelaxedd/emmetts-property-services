/**
 * Plain-text fallbacks used when the AI draft fails or the monthly AI cap is hit. No unsubscribe
 * footer here: the email layer (lib/email) adds it.
 */
import { siteConfig } from "../lib/site-config";

const SIGN_OFF = ["Thanks,", siteConfig.name].join("\n");

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim() || "there";

export function reviewTemplate(input: { name: string; services: string[]; reviewUrl?: string | null }) {
  const what = input.services.length ? input.services.join(", ").toLowerCase() : "the work";
  const ask = input.reviewUrl
    ? `If you were happy with ${what}, would you leave us a quick review? It takes a minute: ${input.reviewUrl}`
    : `If you were happy with ${what}, a quick review or a word to your neighbors would mean a lot to us.`;
  return {
    subject: `Thanks from ${siteConfig.name}`,
    body: [`Hi ${firstName(input.name)},`, "", `Thanks for having us out. ${ask}`, "", SIGN_OFF].join("\n"),
  };
}

export function reminderTemplate(input: { name: string; when: string; services: string[]; address?: string | null }) {
  const what = input.services.length ? input.services.join(", ").toLowerCase() : "your job";
  const where = input.address ? ` at ${input.address}` : "";
  return {
    subject: `Reminder: we're coming ${input.when}`,
    body: [
      `Hi ${firstName(input.name)},`,
      "",
      `Just a reminder that our crew is scheduled for ${what}${where} ${input.when}.`,
      `If anything changes, call or text us at ${siteConfig.phone.display}.`,
      "",
      SIGN_OFF,
    ].join("\n"),
  };
}

export function snowTemplate(input: { detail: string }) {
  return {
    subject: "Snow is on the way: your snow removal plan",
    body: [
      "Hi there,",
      "",
      `The forecast is calling for snow (${input.detail}). You're on our snow list, so we'll be out to clear your ` +
        "driveway and walks once it stops falling. Please keep cars off the driveway if you can.",
      `Need something different this time? Call or text us at ${siteConfig.phone.display}.`,
      "",
      SIGN_OFF,
    ].join("\n"),
  };
}
