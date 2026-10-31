"use client"

/**
 * localStorage glue for the knock queue (key "canvass.knockQueue"). The pure parts (enqueue, dequeue,
 * merge, backoff) live in lib/canvass/knock-queue.ts with their tests. Every storage access is wrapped:
 * private mode, a full disk or a blocked origin must never break logging, only persistence.
 */
import {
  KNOCK_QUEUE_KEY,
  dequeue,
  dueItems,
  enqueue,
  markFailed,
  mergeQueues,
  parseQueue,
  patchQueued,
  sendDisposition,
  type KnockDetailsPatch,
  type LogKnockInput,
  type QueuedKnock,
} from "@/lib/canvass/knock-queue"

export { KNOCK_QUEUE_KEY, newClientId } from "@/lib/canvass/knock-queue"
export type { KnockDetailsPatch, LogKnockInput, QueuedKnock } from "@/lib/canvass/knock-queue"

export function readQueue(): QueuedKnock[] {
  try {
    return parseQueue(window.localStorage.getItem(KNOCK_QUEUE_KEY))
  } catch {
    return []
  }
}

export function writeQueue(items: readonly QueuedKnock[]): void {
  try {
    if (items.length === 0) window.localStorage.removeItem(KNOCK_QUEUE_KEY)
    else window.localStorage.setItem(KNOCK_QUEUE_KEY, JSON.stringify(items))
  } catch {
    // storage unavailable: the in-memory copy still drives this session
  }
}

/** Add to what is stored (merged with any other tab's copy) and persist. */
export function enqueueKnock(input: LogKnockInput): QueuedKnock[] {
  const next = enqueue(readQueue(), input, Date.now())
  writeQueue(next)
  return next
}

export function dequeueKnock(clientId: string): QueuedKnock[] {
  const next = dequeue(readQueue(), clientId)
  writeQueue(next)
  return next
}

/** Merge details into a queued (not yet sent) knock; returns true when it was still queued. */
export function patchQueuedKnock(clientId: string, patch: KnockDetailsPatch): boolean {
  const items = readQueue()
  if (!items.some((i) => i.input.client_id === clientId)) return false
  writeQueue(patchQueued(items, clientId, patch))
  return true
}

/** `retryable`: the server failed (database blip, timeout), not the knock; the item stays queued with backoff. */
export type SendResult = { ok: true; knock_id: string; message: string; do_not_knock: boolean } | { ok: false; error: string; retryable?: boolean }

export type FlushEvent =
  | { kind: "sent"; clientId: string; result: Extract<SendResult, { ok: true }> }
  | { kind: "rejected"; clientId: string; error: string }
  | { kind: "failed"; clientId: string; error: string }

let flushing = false

/**
 * Send every due item, oldest first. A server "no" (validation, missing house) drops the item so it
 * never blocks the rest; a network failure or a retryable server failure keeps it with backoff. One flush at a time.
 */
export async function flushQueue(send: (input: LogKnockInput) => Promise<SendResult>, onEvent?: (e: FlushEvent) => void): Promise<QueuedKnock[]> {
  if (flushing) return readQueue()
  flushing = true
  try {
    let items = mergeQueues(readQueue(), [])
    for (const item of dueItems(items, Date.now())) {
      const clientId = item.input.client_id
      try {
        const res = await send(item.input)
        const next = sendDisposition(res)
        if (res.ok) {
          items = dequeue(readQueue(), clientId)
          writeQueue(items)
          onEvent?.({ kind: "sent", clientId, result: res })
        } else if (next === "retry") {
          items = markFailed(readQueue(), clientId, res.error, Date.now())
          writeQueue(items)
          onEvent?.({ kind: "failed", clientId, error: res.error })
        } else {
          items = dequeue(readQueue(), clientId)
          writeQueue(items)
          onEvent?.({ kind: "rejected", clientId, error: res.error })
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : "No signal"
        items = markFailed(readQueue(), clientId, error, Date.now())
        writeQueue(items)
        onEvent?.({ kind: "failed", clientId, error })
      }
    }
    return items
  } finally {
    flushing = false
  }
}
