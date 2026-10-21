"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes, type RefObject } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Street-address field with Google Places autocomplete, as a progressive enhancement.
 *
 * - The widget attaches to the **street** input only. The submitted `street` is always a plain
 *   `<input name="street">` (free text). Selecting a suggestion rewrites it to the street line
 *   (street number + route), writes city / state / ZIP into the sibling inputs (passed as refs),
 *   and fills hidden `lat` / `lng` inputs; typing after a selection clears the coordinates again
 *   so stale ones are never sent. The sibling inputs stay ordinary, editable text boxes.
 * - Without NEXT_PUBLIC_GOOGLE_MAPS_API_KEY nothing extra renders and no script loads.
 * - If the script is blocked, errors, times out, or the key is rejected, the field stays a normal
 *   text box. Nothing here ever blocks submission.
 * - Prefers the `PlaceAutocompleteElement` web component; falls back to the classic
 *   `google.maps.places.Autocomplete` bound to the real input.
 */

/* ---------- minimal local typings for the bits of the Maps JS API we touch ---------- */

type GLatLng = { lat(): number; lng(): number };
type GNewComponent = { longText?: string | null; shortText?: string | null; types?: string[] };
type GNewPlace = {
  fetchFields(opts: { fields: string[] }): Promise<unknown>;
  formattedAddress?: string | null;
  addressComponents?: GNewComponent[] | null;
  location?: GLatLng | null;
};
type GSelectEvent = Event & { placePrediction?: { toPlace(): GNewPlace }; place?: GNewPlace };
type GPlaceElement = HTMLElement & { value?: string };
type GClassicComponent = { long_name?: string; short_name?: string; types?: string[] };
type GClassicPlace = {
  formatted_address?: string;
  address_components?: GClassicComponent[];
  geometry?: { location?: GLatLng };
};
type GClassicAutocomplete = { addListener(event: string, handler: () => void): unknown; getPlace(): GClassicPlace };
type GPlacesLib = {
  PlaceAutocompleteElement?: new (options: Record<string, unknown>) => GPlaceElement;
  Autocomplete?: new (input: HTMLInputElement, options?: Record<string, unknown>) => GClassicAutocomplete;
};

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary?: (name: string) => Promise<unknown>;
        places?: GPlacesLib;
        event?: { clearInstanceListeners(instance: unknown): void };
      };
    };
    gm_authFailure?: () => void;
  }
}

/* ---------- config ---------- */

const API_KEY = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "").trim() || null;

/** Rocky River, OH. Suggestions are biased (not restricted) to ~25 miles around it. */
const BASE = { lat: 41.4756, lng: -81.8396 };
const RADIUS_M = 40234; // 25 mi
const LAT_DELTA = 25 / 69; // degrees per mile of latitude
const LNG_DELTA = 25 / (69 * Math.cos((BASE.lat * Math.PI) / 180));
const BIAS_BOUNDS = {
  north: BASE.lat + LAT_DELTA,
  south: BASE.lat - LAT_DELTA,
  east: BASE.lng + LNG_DELTA,
  west: BASE.lng - LNG_DELTA,
};

const SCRIPT_ID = "google-maps-js";
const LOAD_TIMEOUT_MS = 10_000;

const STYLES = `
.pac-container{z-index:60;font-family:var(--font-body),system-ui,sans-serif;border-radius:.75rem;margin-top:4px;touch-action:manipulation}
.pac-item{padding:6px 12px;line-height:1.5;font-size:1rem}
gmp-place-autocomplete{display:block;width:100%;color-scheme:light;--gmp-mat-font-family:var(--font-body),system-ui,sans-serif}
`;

/** Visually hidden but still focusable/submittable (the mirror of the web component's text). */
const MIRROR_STYLE = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: 0,
  padding: 0,
  border: 0,
  overflow: "hidden",
  opacity: 0,
  pointerEvents: "none",
} as const;

/* ---------- loader (once per page; safe under React strict-mode double mount) ---------- */

const authFailureHandlers = new Set<() => void>();
let placesPromise: Promise<GPlacesLib | null> | null = null;

function loadPlaces(key: string): Promise<GPlacesLib | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (placesPromise) return placesPromise;

  placesPromise = new Promise<GPlacesLib | null>((resolve) => {
    const resolveLibrary = async () => {
      try {
        const maps = window.google?.maps;
        const lib = maps?.importLibrary ? ((await maps.importLibrary("places")) as GPlacesLib) : maps?.places;
        resolve(lib ?? null);
      } catch {
        resolve(null);
      }
    };

    window.gm_authFailure = () => {
      authFailureHandlers.forEach((fn) => fn());
    };

    if (window.google?.maps?.importLibrary || window.google?.maps?.places) {
      void resolveLibrary();
      return;
    }

    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async&v=weekly`;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => void resolveLibrary(), { once: true });
    script.addEventListener("error", () => resolve(null), { once: true });
    window.setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
  });
  return placesPromise;
}

/* ---------- helpers ---------- */

/** "123 Main St, Rocky River, OH 44116, USA" -> "123 Main St, Rocky River, OH 44116". */
function stripCountry(formatted: string): string {
  return formatted.replace(/,\s*(USA|United States(?: of America)?)\s*$/i, "").trim();
}

type AddressParts = { street: string; city: string; state: string; zip: string };
type NormalComponent = { long: string; short: string; types: string[] };

/** Splits Places address components (either API's shape, normalised first) into our four fields. */
function partsFromComponents(components: NormalComponent[]): AddressParts {
  const find = (type: string) => components.find((c) => c.types.includes(type));
  const long = (type: string) => find(type)?.long ?? "";
  const city = long("locality") || long("sublocality") || long("postal_town");
  return {
    street: [long("street_number"), long("route")].filter(Boolean).join(" "),
    city,
    state: find("administrative_area_level_1")?.short ?? "",
    zip: long("postal_code"),
  };
}

const fromNew = (list: GNewComponent[] | null | undefined): NormalComponent[] =>
  (list ?? []).map((c) => ({ long: c.longText ?? "", short: c.shortText ?? "", types: c.types ?? [] }));
const fromClassic = (list: GClassicComponent[] | undefined): NormalComponent[] =>
  (list ?? []).map((c) => ({ long: c.long_name ?? "", short: c.short_name ?? "", types: c.types ?? [] }));

function coord(v: unknown): number | null {
  const n = typeof v === "function" ? (v as () => unknown)() : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** True while a classic Places dropdown is open (used to stop Enter from submitting the form). */
function pacVisible(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(".pac-container")).some(
    (c) => c.style.display !== "none" && c.childElementCount > 0,
  );
}

/* ---------- component ---------- */

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "type"> & {
  defaultValue?: string;
  /** Sibling inputs the selected place fills in. Each is optional and left alone when missing. */
  cityRef?: RefObject<HTMLInputElement>;
  stateRef?: RefObject<HTMLInputElement>;
  zipRef?: RefObject<HTMLInputElement>;
};
type Mode = "plain" | "element" | "classic";

export function AddressAutocomplete({ className, defaultValue, cityRef, stateRef, zipRef, ...inputProps }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("plain");

  useEffect(() => {
    const key = API_KEY;
    const input = inputRef.current;
    const host = hostRef.current;
    if (!key || !input || !host) return;

    let disposed = false;
    let teardown: (() => void) | null = null;

    const setCoords = (lat: number | null, lng: number | null) => {
      if (latRef.current) latRef.current.value = lat === null ? "" : String(lat);
      if (lngRef.current) lngRef.current.value = lng === null ? "" : String(lng);
    };
    const clearCoords = () => setCoords(null, null);

    /** Writes the sibling fields; a part Google didn't return leaves the user's own text in place. */
    const fillSiblings = (parts: AddressParts) => {
      const put = (ref: RefObject<HTMLInputElement> | undefined, value: string) => {
        if (ref?.current && value) ref.current.value = value;
      };
      put(cityRef, parts.city);
      put(stateRef, parts.state.toUpperCase());
      put(zipRef, parts.zip);
    };
    /** Street line for the picked place, falling back to the first chunk of the formatted address. */
    const streetFor = (parts: AddressParts, formatted: string | null | undefined) =>
      parts.street || (formatted ? stripCountry(formatted).split(",")[0].trim() : "");

    // Registered before Google's own listener (capture, on the target) so it sees Enter while the
    // dropdown is still open; once Google handles the key the container may already be hidden.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && pacVisible()) e.preventDefault();
    };
    input.addEventListener("keydown", onKeyDown, true);

    const onAuthFailure = () => {
      teardown?.();
      teardown = null;
      if (!disposed) setMode("plain");
    };
    authFailureHandlers.add(onAuthFailure);

    /** New web component. Returns a teardown, or null when unavailable/unsupported. */
    const attachElement = (lib: GPlacesLib): (() => void) | null => {
      const Ctor = lib.PlaceAutocompleteElement;
      if (!Ctor) return null;
      let el: GPlaceElement;
      try {
        el = new Ctor({
          includedRegionCodes: ["us"],
          // The new API has no "address" type; these are its street-address primary types.
          includedPrimaryTypes: ["street_address", "subpremise"],
          locationBias: { center: BASE, radius: RADIUS_M },
        });
      } catch {
        return null;
      }

      // Re-seed after a server error. If this build can't take a value, use the classic widget instead.
      if (input.value) {
        try {
          el.value = input.value;
        } catch {
          /* checked below */
        }
        if (el.value !== input.value) return null;
      }

      let suppress = false;
      const setElValue = (v: string) => {
        suppress = true;
        try {
          el.value = v;
        } catch {
          /* cosmetic only */
        }
        suppress = false;
      };

      const onInput = (ev: Event) => {
        if (suppress) return;
        const inner = ev.composedPath()[0];
        const v = typeof el.value === "string" ? el.value : inner instanceof HTMLInputElement ? inner.value : null;
        if (v !== null) input.value = v;
        clearCoords();
      };
      const onSelect = async (ev: Event) => {
        try {
          const e = ev as GSelectEvent;
          const place = e.placePrediction ? e.placePrediction.toPlace() : e.place;
          if (!place) return;
          await place.fetchFields({ fields: ["addressComponents", "location", "formattedAddress"] });
          if (disposed) return;
          const parts = partsFromComponents(fromNew(place.addressComponents));
          const street = streetFor(parts, place.formattedAddress);
          if (street) {
            input.value = street;
            setElValue(street);
          }
          fillSiblings(parts);
          const loc = place.location;
          setCoords(loc ? coord(loc.lat.bind(loc)) : null, loc ? coord(loc.lng.bind(loc)) : null);
        } catch {
          /* keep what the user typed; the server geocodes it */
        }
      };
      const focusEl = () => {
        const inner = el.shadowRoot?.querySelector("input");
        if (inner) inner.focus();
        else el.focus();
      };

      try {
        el.setAttribute("aria-label", "Street address");
      } catch {
        /* cosmetic */
      }
      el.addEventListener("input", onInput);
      el.addEventListener("gmp-select", onSelect);
      el.addEventListener("gmp-placeselect", onSelect);
      // Labels and error-focus target the real input; hand focus to the widget.
      input.addEventListener("focus", focusEl);
      host.appendChild(el);

      return () => {
        el.removeEventListener("input", onInput);
        el.removeEventListener("gmp-select", onSelect);
        el.removeEventListener("gmp-placeselect", onSelect);
        input.removeEventListener("focus", focusEl);
        el.remove();
      };
    };

    /** Classic widget bound to the real input. Returns a teardown, or null when unavailable. */
    const attachClassic = (lib: GPlacesLib): (() => void) | null => {
      const Ctor = lib.Autocomplete;
      if (!Ctor) return null;
      let ac: GClassicAutocomplete;
      try {
        ac = new Ctor(input, {
          componentRestrictions: { country: "us" },
          types: ["address"],
          fields: ["address_components", "geometry", "formatted_address"],
          bounds: BIAS_BOUNDS, // bias only: strictBounds is left off
        });
      } catch {
        return null;
      }
      const onTyping = () => clearCoords();
      input.addEventListener("input", onTyping);
      ac.addListener("place_changed", () => {
        try {
          const place = ac.getPlace();
          const loc = place.geometry?.location;
          if (!loc || !place.formatted_address) {
            clearCoords(); // Enter with no suggestion picked: leave the typed text alone
            return;
          }
          const parts = partsFromComponents(fromClassic(place.address_components));
          input.value = streetFor(parts, place.formatted_address);
          fillSiblings(parts);
          setCoords(coord(loc.lat.bind(loc)), coord(loc.lng.bind(loc)));
        } catch {
          clearCoords();
        }
      });
      return () => {
        input.removeEventListener("input", onTyping);
        window.google?.maps?.event?.clearInstanceListeners(ac);
      };
    };

    void loadPlaces(key).then((lib) => {
      if (disposed || !lib) return;
      const el = attachElement(lib);
      if (el) {
        teardown = el;
        setMode("element");
        return;
      }
      const classic = attachClassic(lib);
      if (classic) {
        teardown = classic;
        setMode("classic");
      }
    });

    return () => {
      disposed = true;
      authFailureHandlers.delete(onAuthFailure);
      input.removeEventListener("keydown", onKeyDown, true);
      teardown?.();
      teardown = null;
    };
  }, [cityRef, stateRef, zipRef]);

  const enhanced = API_KEY !== null;
  const mirrored = mode === "element";

  return (
    <div className="relative">
      {enhanced && <style>{STYLES}</style>}
      <Input
        {...inputProps}
        ref={inputRef}
        name="street"
        defaultValue={defaultValue}
        // Keep the browser's own dropdown from fighting Google's.
        autoComplete={enhanced ? "off" : inputProps.autoComplete}
        className={className}
        style={mirrored ? MIRROR_STYLE : inputProps.style}
        tabIndex={mirrored ? -1 : inputProps.tabIndex}
        aria-hidden={mirrored ? true : inputProps["aria-hidden"]}
      />
      {enhanced && (
        <>
          <div ref={hostRef} className={cn(!mirrored && "hidden")} />
          <input ref={latRef} type="hidden" name="lat" defaultValue="" />
          <input ref={lngRef} type="hidden" name="lng" defaultValue="" />
        </>
      )}
    </div>
  );
}
