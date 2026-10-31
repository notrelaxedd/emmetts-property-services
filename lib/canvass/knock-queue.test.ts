import { describe, expect, it } from "vitest";
import {
  backoffMs,
  dequeue,
  dueItems,
  enqueue,
  markFailed,
  mergeQueues,
  newClientId,
  parseQueue,
  patchQueued,
  sendDisposition,
  type LogKnockInput,
  type QueuedKnock,
} from "./knock-queue";

const input = (over: Partial<LogKnockInput> = {}): LogKnockInput => ({
  client_id: "c1",
  parcel_id: "p1",
  outcome: "no_answer",
  knocked_at: "2026-10-30T15:00:00.000Z",
  lat: 41.47,
  lng: -81.84,
  pitch_id: null,
  ...over,
});

describe("knock queue", () => {
  it("enqueue adds and replaces by client_id", () => {
    let q: QueuedKnock[] = [];
    q = enqueue(q, input(), 100);
    q = enqueue(q, input({ client_id: "c2", knocked_at: "2026-10-30T15:01:00.000Z" }), 100);
    expect(q.map((i) => i.input.client_id)).toEqual(["c1", "c2"]);
    q = enqueue(q, input({ notes: "again" }), 200);
    expect(q).toHaveLength(2);
    expect(q.find((i) => i.input.client_id === "c1")?.input.notes).toBe("again");
    expect(q[0].attempts).toBe(0);
  });

  it("dequeue removes one item and leaves the rest", () => {
    const q = enqueue(enqueue([], input(), 0), input({ client_id: "c2" }), 0);
    expect(dequeue(q, "c1").map((i) => i.input.client_id)).toEqual(["c2"]);
    expect(dequeue(q, "nope")).toHaveLength(2);
  });

  it("patchQueued merges details only into the queued item", () => {
    const q = enqueue([], input(), 0);
    const patched = patchQueued(q, "c1", { notes: "dog in yard", home_pattern: "evenings_only", pitch_id: undefined });
    expect(patched[0].input.notes).toBe("dog in yard");
    expect(patched[0].input.home_pattern).toBe("evenings_only");
    expect(patched[0].input.pitch_id).toBeNull();
    expect(patchQueued(q, "other", { notes: "x" })[0].input.notes).toBeUndefined();
  });

  it("mergeQueues keeps one per client_id, the copy with more attempts, ordered by time", () => {
    const a = [
      { input: input({ client_id: "c2", knocked_at: "2026-10-30T15:05:00.000Z" }), attempts: 0, nextAt: 0, lastError: null },
      { input: input(), attempts: 1, nextAt: 50, lastError: "offline" },
    ];
    const b = [{ input: input(), attempts: 0, nextAt: 0, lastError: null }];
    const merged = mergeQueues(a, b);
    expect(merged.map((i) => i.input.client_id)).toEqual(["c1", "c2"]);
    expect(merged[0].attempts).toBe(1);
  });

  it("markFailed backs off and dueItems respects nextAt", () => {
    let q = enqueue([], input(), 0);
    q = markFailed(q, "c1", "no signal", 1_000);
    expect(q[0].attempts).toBe(1);
    expect(q[0].nextAt).toBe(1_000 + backoffMs(1));
    expect(q[0].lastError).toBe("no signal");
    expect(dueItems(q, 1_000)).toHaveLength(0);
    expect(dueItems(q, 1_000 + backoffMs(1))).toHaveLength(1);
  });

  it("backoff doubles and caps at two minutes", () => {
    expect(backoffMs(0)).toBe(2_000);
    expect(backoffMs(1)).toBe(4_000);
    expect(backoffMs(3)).toBe(16_000);
    expect(backoffMs(20)).toBe(120_000);
  });

  it("parseQueue drops junk and tolerates bad JSON", () => {
    expect(parseQueue("not json")).toEqual([]);
    expect(parseQueue(null)).toEqual([]);
    const raw = JSON.stringify([
      { input: input(), attempts: "x", nextAt: 5 },
      { input: { client_id: 1 } },
      "junk",
    ]);
    const parsed = parseQueue(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].attempts).toBe(0);
    expect(parsed[0].nextAt).toBe(5);
  });

  it("newClientId looks like a uuid", () => {
    expect(newClientId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newClientId()).not.toBe(newClientId());
  });
});

describe("sendDisposition", () => {
  it("keeps a knock the server failed on (retryable) and drops one it refused", () => {
    expect(sendDisposition({ ok: true })).toBe("sent");
    expect(sendDisposition({ ok: false })).toBe("drop");
    expect(sendDisposition({ ok: false, retryable: false })).toBe("drop");
    expect(sendDisposition({ ok: false, retryable: true })).toBe("retry");
  });
});
