/**
 * SMS provider. Log-only for now.
 * Plain Node: no `server-only`, no `next/*`, no NEXT_PUBLIC_* (fleet workers import this too).
 */

export type OutboundSms = { to: string; body: string };
export type SmsProvider = { send(msg: OutboundSms): Promise<{ id: string | null }> };

const logSmsProvider: SmsProvider = {
  async send(msg) {
    const body = msg.body.replace(/\s+/g, " ").trim();
    const preview = body.length > 80 ? `${body.slice(0, 77)}...` : body;
    console.log(`[sms:log] to=${msg.to} body=${JSON.stringify(preview)}`);
    return { id: null };
  },
};

export function getSmsProvider(): SmsProvider {
  const name = process.env.SMS_PROVIDER ?? "log";
  if (name === "log") return logSmsProvider;
  // TODO [SMS PROVIDER — ask owner]: Twilio / Telnyx / etc. Needs 10DLC registration before real sends.
  throw new Error(`TODO [SMS PROVIDER]: "${name}" not configured (only "log" is implemented)`);
}
