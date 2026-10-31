import { describe, expect, it } from "vitest";
import { houseDistance, houseNumber, nearCustomerLevel, streetOf } from "./score";

describe("addresses", () => {
  it("parses house numbers and streets", () => {
    expect(houseNumber("1234 Elm Rd")).toBe(1234);
    expect(houseNumber("  42 Oak Ave")).toBe(42);
    expect(houseNumber("Elm Rd")).toBeNull();
    expect(houseNumber(null)).toBeNull();
    expect(streetOf("1234 Elm Rd")).toBe("ELM RD");
    expect(streetOf("1234-36 Elm  Rd")).toBe("ELM RD");
    expect(streetOf("Elm Rd")).toBe("ELM RD");
  });
  it("counts houses on the same side of the street", () => {
    expect(houseDistance(100, 106)).toBe(3);
    expect(houseDistance(100, 101)).toBeNull();
    expect(houseDistance(100, 100)).toBe(0);
    const street = [100, 102, 104, 110, 112].map((n) => ({ address: `${n} Elm Rd` }));
    expect(houseDistance(100, 104, street)).toBe(2);
    expect(houseDistance(100, 110, street)).toBe(3);
    expect(houseDistance(100, 120, street)).toBe(8); // 4 known up to 112, then 114–120 at a step of 2
    expect(houseDistance(102, 100, street)).toBe(1);
  });
  it("does not treat a far house missing from a partial street list as next door", () => {
    expect(houseDistance(100, 2000, [{ address: "100 ELM RD" }])).toBe(950);
    expect(houseDistance(100, 2000, [100, 102, 104].map((n) => ({ address: `${n} ELM RD` })))).toBe(950);
    const parcel = { address: "100 Elm Rd", street: "ELM RD", centroid_lat: 41.4756, centroid_lng: -81.8396 };
    expect(nearCustomerLevel(parcel, [{ address: "2000 Elm Rd", lat: null, lng: null }], 3, [{ address: "100 ELM RD" }])).toBe("street");
  });
});

describe("nearCustomerLevel", () => {
  const parcel = { address: "100 Elm Rd", street: "ELM RD", centroid_lat: 41.4756, centroid_lng: -81.8396 };
  it("is adjacent within N houses on the same street even when coordinates are far", () => {
    const customers = [{ address: "106 Elm Rd", lat: 41.49, lng: -81.9 }];
    expect(nearCustomerLevel(parcel, customers, 3)).toBe("adjacent");
    expect(nearCustomerLevel(parcel, customers, 2)).toBe("street");
    expect(nearCustomerLevel(parcel, [{ address: "106 Oak Ave", lat: 41.49, lng: -81.9 }], 3)).toBe("none");
  });
  it("uses the street's parcels to count real houses", () => {
    const street = [100, 102, 110].map((n) => ({ address: `${n} Elm Rd` }));
    const customers = [{ address: "110 Elm Rd", lat: 41.49, lng: -81.9 }];
    expect(nearCustomerLevel(parcel, customers, 3)).toBe("street"); // numbers alone: 5 houses apart
    expect(nearCustomerLevel(parcel, customers, 3, street)).toBe("adjacent"); // really 2 houses apart
  });
  it("falls back to metres: near within 150 m, else none", () => {
    // ~0.001 deg lat ~ 111 m; 0.002 ~ 222 m.
    expect(nearCustomerLevel(parcel, [{ lat: 41.4756 + 0.00045, lng: -81.8396 }], 3)).toBe("near");
    expect(nearCustomerLevel(parcel, [{ lat: 41.4756 + 0.001, lng: -81.8396 }], 3)).toBe("near");
    expect(nearCustomerLevel(parcel, [{ lat: 41.4756 + 0.002, lng: -81.8396 }], 3)).toBe("none");
    expect(nearCustomerLevel(parcel, [{ address: "101 Elm Rd", lat: 41.4756 + 0.0002, lng: -81.8396 }], 3)).toBe("near"); // across the street
    expect(nearCustomerLevel(parcel, [], 3)).toBe("none");
    expect(nearCustomerLevel({ ...parcel, centroid_lat: null, centroid_lng: null }, [{ lat: 41.4756, lng: -81.8396 }], 3)).toBe("none");
  });
  it("same street but far away is street; the best level wins across customers", () => {
    const far = { address: "900 Elm Rd", lat: 41.49, lng: -81.9 };
    expect(nearCustomerLevel(parcel, [far], 3)).toBe("street");
    expect(nearCustomerLevel(parcel, [far, { lat: 41.4756 + 0.001, lng: -81.8396 }], 3)).toBe("near");
    expect(nearCustomerLevel(parcel, [{ lat: 41.4756 + 0.001, lng: -81.8396 }, far, { address: "102 Elm Rd", lat: null, lng: null }], 3)).toBe("adjacent");
  });
});
