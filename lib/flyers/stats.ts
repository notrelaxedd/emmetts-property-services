/**
 * Flyer funnel per worker: flyers handed out -> unique QR scans -> quote requests -> jobs booked,
 * plus pay owed / paid. Pure, so it's unit-testable; lib/flyers/load.ts feeds it from the database.
 */

export type FlyerFunnel = {
  flyersOut: number;
  scans: number;
  requests: number;
  booked: number;
  /** Jobs booked ÷ flyers handed out. Null until a batch is logged. */
  conversion: number | null;
  /** Unique scans ÷ flyers handed out. */
  scanRate: number | null;
  /** Jobs booked ÷ quote requests. */
  closeRate: number | null;
  owed: number;
  paid: number;
};

export type FunnelInput = {
  batches: readonly { flyer_worker_id: string; flyer_count: number; amount: number; paid_at: string | null }[];
  scans: readonly { flyer_worker_id: string; visitor: string }[];
  /** Leads credited to a flyer worker (spam already excluded or not: spam is skipped here). */
  leads: readonly { id: string; flyer_worker_id: string | null; status: string }[];
  /** Lead ids with at least one job that isn't cancelled. */
  bookedLeadIds: ReadonlySet<string>;
};

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);
const cents = (n: number) => Math.round(n * 100) / 100;

function finish(f: Omit<FlyerFunnel, "conversion" | "scanRate" | "closeRate">): FlyerFunnel {
  return {
    ...f,
    owed: cents(f.owed),
    paid: cents(f.paid),
    conversion: ratio(f.booked, f.flyersOut),
    scanRate: ratio(f.scans, f.flyersOut),
    closeRate: ratio(f.booked, f.requests),
  };
}

export function emptyFunnel(): FlyerFunnel {
  return finish({ flyersOut: 0, scans: 0, requests: 0, booked: 0, owed: 0, paid: 0 });
}

/** One funnel per worker id that appears in any input (look up missing ids with emptyFunnel()). */
export function flyerFunnels(input: FunnelInput): Map<string, FlyerFunnel> {
  type Acc = { flyersOut: number; visitors: Set<string>; requests: number; booked: number; owed: number; paid: number };
  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { flyersOut: 0, visitors: new Set(), requests: 0, booked: 0, owed: 0, paid: 0 }));
    return a;
  };

  for (const b of input.batches) {
    const a = get(b.flyer_worker_id);
    a.flyersOut += b.flyer_count;
    if (b.paid_at) a.paid += Number(b.amount);
    else a.owed += Number(b.amount);
  }
  for (const s of input.scans) get(s.flyer_worker_id).visitors.add(s.visitor);
  for (const l of input.leads) {
    if (!l.flyer_worker_id || l.status === "spam") continue;
    const a = get(l.flyer_worker_id);
    a.requests++;
    if (input.bookedLeadIds.has(l.id)) a.booked++;
  }

  const out = new Map<string, FlyerFunnel>();
  acc.forEach((a, id) =>
    out.set(id, finish({ flyersOut: a.flyersOut, scans: a.visitors.size, requests: a.requests, booked: a.booked, owed: a.owed, paid: a.paid })),
  );
  return out;
}

/** All workers together (unique scans are already per worker, so they simply add up). */
export function totalFunnel(funnels: Iterable<FlyerFunnel>): FlyerFunnel {
  const t = { flyersOut: 0, scans: 0, requests: 0, booked: 0, owed: 0, paid: 0 };
  for (const f of Array.from(funnels)) {
    t.flyersOut += f.flyersOut;
    t.scans += f.scans;
    t.requests += f.requests;
    t.booked += f.booked;
    t.owed += f.owed;
    t.paid += f.paid;
  }
  return finish(t);
}

/** 0.0123 -> "1.2%"; null -> "—". */
export function percent(r: number | null): string {
  if (r === null) return "—";
  const p = r * 100;
  return `${p >= 10 || p === 0 ? p.toFixed(0) : p.toFixed(1)}%`;
}
