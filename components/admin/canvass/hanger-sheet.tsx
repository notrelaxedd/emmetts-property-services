import Image from "next/image"
import type { HangerCopy } from "@/lib/canvass/streets"

export type HangerSheetProps = {
  code: string
  street: string
  /** PNG data URL of the QR pointing at /h/<code>. */
  qrDataUrl: string
  copy: HangerCopy
  phone: string
  businessName: string
}

/**
 * Three 3.5in x 8.5in door hangers side by side on a landscape Letter sheet (11in x 8.5in), with a 1.25in door-hole
 * circle at the top of each and dashed cut lines between them. Sizes are in inches so the print matches the paper.
 * Server component: the QR is passed in as a data URL.
 */
export function HangerSheet({ code, street, qrDataUrl, copy, phone, businessName }: HangerSheetProps) {
  return (
    <div
      id="hanger-sheet"
      className="mx-auto flex bg-white text-ink shadow-md"
      style={{ width: "11in", height: "8.5in" }}
      aria-label={`Door hanger sheet for ${street}, code ${code}`}
    >
      {[0, 1, 2].map((i) => (
        <Hanger key={i} code={code} qrDataUrl={qrDataUrl} copy={copy} phone={phone} businessName={businessName} />
      ))}
    </div>
  )
}

function Hanger({ code, qrDataUrl, copy, phone, businessName }: Omit<HangerSheetProps, "street">) {
  return (
    <section
      className="flex shrink-0 flex-col items-center border-l border-dashed border-gray-400 text-center first:border-l-0"
      style={{ width: "3.5in", height: "8.5in", padding: "0.3in 0.3in 0.35in" }}
    >
      {/* Door-hole: cut along the dashed circle. */}
      <div
        aria-hidden="true"
        className="shrink-0 rounded-full border border-dashed border-gray-400"
        style={{ width: "1.25in", height: "1.25in" }}
      />
      <Image src="/logo.png" alt={businessName} width={960} height={839} unoptimized priority className="mt-3 h-auto w-[1.3in]" />
      <h2 className="mt-3 font-heading text-[19px] font-bold leading-tight tracking-tight">{copy.headline}</h2>
      <p className="mt-2 w-full rounded-md bg-brand-green/20 px-2 py-1.5 text-[12px] font-semibold leading-snug text-brand-green-dark">
        {copy.offer}
      </p>
      <ul className="mt-3 w-full space-y-1 text-left text-[12px] leading-snug">
        {copy.bullets.map((line) => (
          <li key={line} className="flex gap-1.5">
            <span aria-hidden="true" className="mt-[3px] inline-block size-1.5 shrink-0 rounded-full bg-brand-green-dark" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-ink-muted">Call or text</p>
      <p className="text-[18px] font-bold tabular-nums tracking-tight">{phone}</p>
      <div className="mt-auto flex flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the qrcode package */}
        <img src={qrDataUrl} alt={`QR code ${code}`} width={180} height={180} style={{ width: "1.9in", height: "1.9in" }} />
        <p className="mt-1 font-mono text-[11px] tracking-[0.2em] text-gray-500">{code}</p>
        <p className="mt-1 text-[12px] font-semibold">Scan to get a free quote</p>
      </div>
    </section>
  )
}
