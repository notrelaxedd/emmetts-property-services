"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { respondByToken, type RespondResult } from "./actions";

/**
 * Two big buttons. `initial` preselects what the email link said (?r=available|cant) so the crew member
 * taps once to confirm; nothing is recorded until they do.
 */
export function RespondForm({ token, initial, current }: { token: string; initial: "available" | "cant" | null; current: "offered" | "accepted" | "declined" }) {
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<RespondResult | null>(null);
  const [busy, setBusy] = React.useState<"accepted" | "declined" | null>(null);

  const answer = (response: "accepted" | "declined") => {
    setBusy(response);
    startTransition(async () => {
      setResult(await respondByToken(token, response));
      setBusy(null);
    });
  };

  if (result?.ok) {
    const yes = result.response === "accepted";
    return (
      <div role="status" className="space-y-3 rounded-lg border border-ink/10 bg-white p-5 text-center shadow-sm">
        <p className="text-2xl font-bold text-ink">{yes ? "Thanks, you're down as free." : "Thanks for letting us know."}</p>
        <p className="text-sm text-ink-muted">
          {yes
            ? result.confirmed
              ? "Enough of the crew is free. The owner confirms the day with the customer, then picks who goes. You'll see it in the app once it's set."
              : "The owner confirms the day with the customer, then picks who goes. You'll see it in the app once it's set."
            : "We'll ask someone else. Changed your mind? You can still answer again below until the job is confirmed."}
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Button asChild variant="outline">
            <Link href="/crew/offers">Open the crew app</Link>
          </Button>
          {yes ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => answer("declined")}>
              Actually, I can&apos;t make it
            </Button>
          ) : (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => answer("accepted")}>
              Actually, I&apos;m free
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {result && !result.ok ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {result.error}
        </p>
      ) : null}
      {current !== "offered" ? (
        <p className="text-sm text-ink-muted">
          You answered <strong>{current === "accepted" ? "available" : "can't make it"}</strong> already. Tap again to change it.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant={initial === "cant" ? "default" : "outline"} className="h-14 text-base" disabled={pending} onClick={() => answer("declined")}>
          {busy === "declined" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <X aria-hidden="true" />}
          Can&apos;t make it
        </Button>
        <Button type="button" variant={initial === "cant" ? "outline" : "default"} className="h-14 text-base" disabled={pending} onClick={() => answer("accepted")}>
          {busy === "accepted" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          I&apos;m available
        </Button>
      </div>
      <p className="text-center text-xs text-ink-muted">Not a commitment yet: the owner confirms the day with the customer first.</p>
    </div>
  );
}
