"use client"

import { Camera, Loader2, LogOut, Play, Repeat, Undo2, X, CheckCircle2 } from "lucide-react"
import * as React from "react"
import { cancelSwap, completeJob, dropJob, offerSwap, startJob, uploadJobPhoto } from "@/app/crew/actions/jobs"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { NumberStepper } from "@/components/ui/number-stepper"
import { useToast } from "@/components/ui/toast"
import type { JobStatus } from "@/lib/db/types"
import { useCrewAction } from "./use-crew-action"

export type JobActionsProps = {
  jobId: string
  jobStatus: JobStatus
  estMinutes: number
  /** The job's local day is today or earlier (Start is only offered on the day). */
  startsToday: boolean
  insideNotice: boolean
  noticeHours: number
  /** Swap offers I have out for this job. */
  openSwaps: number
  /** Crew who could be offered a swap. */
  eligibleForSwap: number
  photoCount: number
}

const big = "h-14 w-full text-base"
const MAX_UPLOAD_BYTES = 950 * 1024 // stays under the 1 MB server-action body limit
const MAX_NEW_PHOTOS = 6

export function JobActions(props: JobActionsProps) {
  const { jobId, jobStatus, startsToday } = props
  const { run, pending, busyKey } = useCrewAction()
  const [dialog, setDialog] = React.useState<null | "swap" | "drop" | "complete">(null)
  const close = () => setDialog(null)

  const canHandOff = jobStatus === "proposed" || jobStatus === "crew_confirmed" || jobStatus === "booked"
  const spin = (key: string) => (busyKey === key ? <Loader2 className="animate-spin" aria-hidden="true" /> : null)

  return (
    <div className="flex flex-col gap-3">
      {jobStatus === "booked" && startsToday ? (
        <Button type="button" className={big} disabled={pending} onClick={() => run("start", () => startJob(jobId))}>
          {spin("start") ?? <Play aria-hidden="true" />}
          Start job
        </Button>
      ) : null}

      {jobStatus === "in_progress" || (jobStatus === "booked" && startsToday) ? (
        <Button
          type="button"
          variant={jobStatus === "in_progress" ? "default" : "outline"}
          className={big}
          disabled={pending}
          onClick={() => setDialog("complete")}
        >
          <CheckCircle2 aria-hidden="true" />
          Complete job
        </Button>
      ) : null}

      {jobStatus === "booked" && !startsToday ? (
        <p className="text-center text-sm text-ink-muted">Start and Complete show up on the day of the job.</p>
      ) : null}

      {canHandOff ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <p className="text-sm font-semibold text-ink">Can&rsquo;t make it?</p>
            {props.openSwaps > 0 ? (
              <div className="flex flex-col gap-2 rounded-md bg-gray-light p-3">
                <p className="text-sm text-ink">
                  Swap offered to {props.openSwaps} crew member{props.openSwaps === 1 ? "" : "s"}. You keep the job until
                  someone takes it.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={pending}
                  onClick={() => run("cancel-swap", () => cancelSwap(jobId))}
                >
                  {spin("cancel-swap") ?? <Undo2 aria-hidden="true" />}
                  Cancel swap
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="h-12 text-base" disabled={pending} onClick={() => setDialog("swap")}>
                <Repeat aria-hidden="true" />
                Offer swap
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="h-12 border-destructive/40 text-base text-destructive hover:bg-destructive/5 hover:text-destructive"
              disabled={pending}
              onClick={() => setDialog("drop")}
            >
              <LogOut aria-hidden="true" />
              Drop job
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Offer swap */}
      <Dialog open={dialog === "swap"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Offer a swap?</DialogTitle>
            <DialogDescription>
              {props.eligibleForSwap > 0
                ? `We'll offer it to ${props.eligibleForSwap} crew member${props.eligibleForSwap === 1 ? "" : "s"} who aren't paused. The first to accept takes it. Until then it's still yours.`
                : "Nobody else is available to offer it to right now. You can drop it instead and we'll look for cover."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-12">
                Keep it
              </Button>
            </DialogClose>
            <Button
              type="button"
              className="h-12"
              disabled={pending || props.eligibleForSwap === 0}
              onClick={async () => {
                if (await run("swap", () => offerSwap(jobId))) close()
              }}
            >
              {spin("swap") ?? <Repeat aria-hidden="true" />}
              Offer swap
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Drop */}
      <Dialog open={dialog === "drop"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Drop this job?</DialogTitle>
            <DialogDescription>
              {props.insideNotice
                ? `It's less than ${props.noticeHours} hours away, so the owner has to OK the drop. You stay on the job until they do.`
                : "You'll come off the job and the scheduler will look for someone to cover it."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-12">
                Keep it
              </Button>
            </DialogClose>
            <Button
              type="button"
              className="h-12 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={pending}
              onClick={async () => {
                if (await run("drop", () => dropJob(jobId))) close()
              }}
            >
              {spin("drop") ?? <LogOut aria-hidden="true" />}
              {props.insideNotice ? "Ask to drop" : "Drop job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CompleteDialog
        open={dialog === "complete"}
        onClose={close}
        jobId={jobId}
        estMinutes={props.estMinutes}
        photoCount={props.photoCount}
      />
    </div>
  )
}

/** Downscale to ≤1600px JPEG so each upload fits the server-action body limit. Falls back to the original. */
async function shrinkPhoto(file: File): Promise<File> {
  if (file.size <= 400 * 1024 && /^image\/(jpeg|png|webp)$/.test(file.type)) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext("2d")
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    for (const quality of [0.82, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality))
      if (blob && blob.size <= MAX_UPLOAD_BYTES) {
        return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" })
      }
    }
  } catch {
    // e.g. HEIC on a browser that can't decode it: send as-is if it's small enough.
  }
  return file
}

function CompleteDialog({
  open,
  onClose,
  jobId,
  estMinutes,
  photoCount,
}: {
  open: boolean
  onClose: () => void
  jobId: string
  estMinutes: number
  photoCount: number
}) {
  const { toast } = useToast()
  const { run, pending } = useCrewAction()
  const estHours = Math.max(0.25, Math.round((estMinutes / 60) * 4) / 4)
  const [hours, setHours] = React.useState(estHours)
  const [photos, setPhotos] = React.useState<File[]>([])
  const [progress, setProgress] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const busy = pending || progress !== null

  React.useEffect(() => {
    if (open) {
      setHours(estHours)
      setPhotos([])
      setProgress(null)
    }
  }, [open, estHours])

  const submit = async () => {
    // Upload photos one at a time, then finish the job.
    for (let i = 0; i < photos.length; i++) {
      setProgress(`Uploading photo ${i + 1} of ${photos.length}…`)
      const file = await shrinkPhoto(photos[i])
      if (file.size > MAX_UPLOAD_BYTES) {
        toast({ title: `“${photos[i].name}” is too big to upload. Skipped it.`, variant: "destructive" })
        continue
      }
      const fd = new FormData()
      fd.set("jobId", jobId)
      fd.set("photo", file)
      let res: Awaited<ReturnType<typeof uploadJobPhoto>>
      try {
        res = await uploadJobPhoto(fd)
      } catch {
        res = { ok: false, error: "Upload failed. Check your signal." }
      }
      if (!res.ok) {
        toast({ title: res.error, variant: "destructive" })
        setProgress(null)
        return
      }
      // Uploaded photos stay with the job even if completing fails; don't re-send them.
      setPhotos((prev) => prev.filter((p) => p !== photos[i]))
    }
    setProgress("Saving…")
    const ok = await run("complete", () => completeJob({ jobId, hours }))
    setProgress(null)
    if (ok) onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete job</DialogTitle>
          <DialogDescription>How long did it actually take? This is what you get paid for.</DialogDescription>
        </DialogHeader>

        <NumberStepper label="Hours on site" value={hours} onChange={setHours} min={0.25} max={24} step={0.25} suffix="hrs" />

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink">
            Photos <span className="font-normal text-ink-muted">(optional)</span>
          </p>
          {photoCount ? (
            <p className="text-sm text-ink-muted">
              {photoCount} already uploaded for this job.
            </p>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? [])
              setPhotos((prev) => [...prev, ...picked].slice(0, MAX_NEW_PHOTOS))
              e.target.value = ""
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="h-12 text-base"
            disabled={busy || photos.length >= MAX_NEW_PHOTOS}
            onClick={() => inputRef.current?.click()}
          >
            <Camera aria-hidden="true" />
            Add photos
          </Button>
          {photos.length ? (
            <ul className="flex flex-col gap-1">
              {photos.map((p, i) => (
                <li key={`${p.name}-${i}`} className="flex min-h-11 items-center gap-2 rounded-md bg-gray-light px-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                    className="inline-flex size-11 items-center justify-center rounded-md text-ink-muted hover:bg-ink/[0.06] hover:text-ink"
                  >
                    <X className="size-4" aria-hidden="true" />
                    <span className="sr-only">Remove {p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {progress ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {progress}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" className="h-12" disabled={busy}>
              Not yet
            </Button>
          </DialogClose>
          <Button type="button" className="h-12" disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
            Mark complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
