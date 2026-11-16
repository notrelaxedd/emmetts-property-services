/**
 * The best order to visit a set of houses from a start point (Map tab). Pure: no database, no clock, so the
 * browser can re-plan as houses are added or the start changes.
 *
 * Small routes (up to 9 houses) are solved exactly by trying every order; bigger ones use the same
 * nearest-neighbour + 2-opt pass as the mowing and snow routes. Distance is straight-line miles × a road factor.
 */
import { haversineMiles, type LatLng } from "../geo/distance";
import { ROAD_FACTOR, driveMinutes, mapsUrls, orderStops } from "../snow/route";

export type DayStop = { id: string; lat: number; lng: number };

export type DayLeg<T> = T & { order: number; driveMinutes: number; miles: number };

export type DayRoute<T> = { stops: DayLeg<T>[]; driveMinutes: number; miles: number; mapsUrls: string[] };

/** Every order is tried up to this many stops (9! = 362,880 paths). */
export const EXACT_LIMIT = 9;

const roadMiles = (a: LatLng, b: LatLng) => haversineMiles(a, b) * ROAD_FACTOR;

function exactOrder<T extends DayStop>(start: LatLng, stops: T[]): T[] {
  const n = stops.length;
  const fromStart = stops.map((s) => roadMiles(start, s));
  const between = stops.map((a) => stops.map((b) => roadMiles(a, b)));
  let best = Infinity;
  let bestOrder: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const path: number[] = [];
  const walk = (last: number, miles: number) => {
    if (miles >= best) return;
    if (path.length === n) {
      best = miles;
      bestOrder = [...path];
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      path.push(i);
      walk(i, miles + (last < 0 ? fromStart[i] : between[last][i]));
      path.pop();
      used[i] = false;
    }
  };
  walk(-1, 0);
  return bestOrder.map((i) => stops[i]);
}

export function planDayRoute<T extends DayStop>(start: LatLng, stops: T[], mph = 25): DayRoute<T> {
  const ordered =
    stops.length <= 1
      ? stops
      : stops.length <= EXACT_LIMIT
        ? exactOrder(start, stops)
        : (orderStops(start, stops.map((s) => ({ ...s, name: "", address: null, minutes: 0 })), mph).map((o) => stops.find((s) => s.id === o.id)) as T[]);
  let at: LatLng = start;
  let totalMinutes = 0;
  let totalMiles = 0;
  const legs = ordered.map((s, i): DayLeg<T> => {
    const minutes = driveMinutes(at, s, mph);
    const miles = roadMiles(at, s);
    totalMinutes += minutes;
    totalMiles += miles;
    at = s;
    return { ...s, order: i + 1, driveMinutes: minutes, miles };
  });
  return { stops: legs, driveMinutes: totalMinutes, miles: totalMiles, mapsUrls: ordered.length ? mapsUrls(start, ordered) : [] };
}
