import { describe, expect, it } from "vitest";
import { fullAddress, houseNumber, ownerFirstName, titleCaseAddress, titleCaseCity, zip5 } from "./address";

describe("titleCaseAddress", () => {
  it("title-cases the street line and keeps ordinals and directions sensible", () => {
    expect(titleCaseAddress("1234 LAKEVIEW AVE")).toBe("1234 Lakeview Ave");
    expect(titleCaseAddress("W 210TH ST")).toBe("W 210th St");
    expect(titleCaseAddress("55 NE 3RD AVE")).toBe("55 NE 3rd Ave");
    expect(titleCaseAddress("1 S MAIN ST")).toBe("1 S Main St");
    expect(titleCaseAddress("22 O'BRIEN DR")).toBe("22 O'Brien Dr");
    expect(titleCaseAddress("9 MARTIN LUTHER KING JR DR APT 4B")).toBe("9 Martin Luther King Jr Dr Apt 4B");
    expect(titleCaseAddress("12A ELM RD")).toBe("12A Elm Rd");
  });
  it("is idempotent and tolerant of blanks", () => {
    expect(titleCaseAddress("W 210th St")).toBe("W 210th St");
    expect(titleCaseAddress("  1234   LAKEVIEW  AVE ")).toBe("1234 Lakeview Ave");
    expect(titleCaseAddress(null)).toBe("");
    expect(titleCaseAddress(undefined)).toBe("");
  });
});

describe("fullAddress", () => {
  it("builds street, city, state zip", () => {
    expect(fullAddress({ address: "1234 LAKEVIEW AVE", city: "ROCKY RIVER", state: "oh", zip: "44116" })).toBe(
      "1234 Lakeview Ave, Rocky River, OH 44116",
    );
  });
  it("reduces ZIP+4 and numeric-ish zips to five digits", () => {
    expect(fullAddress({ address: "1 A ST", city: "Lakewood", state: "OH", zip: "44107-1234" })).toBe("1 A St, Lakewood, OH 44107");
    expect(zip5("44116")).toBe("44116");
    expect(zip5("4411")).toBe("");
    expect(zip5(null)).toBe("");
  });
  it("skips missing parts without dangling commas", () => {
    expect(fullAddress({ address: "1234 LAKEVIEW AVE", city: null, state: "OH", zip: "44116" })).toBe("1234 Lakeview Ave, OH 44116");
    expect(fullAddress({ address: "1234 LAKEVIEW AVE", city: "ROCKY RIVER", state: "OH", zip: null })).toBe("1234 Lakeview Ave, Rocky River, OH");
    expect(fullAddress({ address: "1234 LAKEVIEW AVE", city: "ROCKY RIVER", zip: null })).toBe("1234 Lakeview Ave, Rocky River");
    expect(fullAddress({ address: "1234 LAKEVIEW AVE", city: "", state: "", zip: "" })).toBe("1234 Lakeview Ave");
    expect(fullAddress({ address: "", city: "ROCKY RIVER", state: "OH", zip: "44116" })).toBe("Rocky River, OH 44116");
  });
  it("title-cases city names", () => {
    expect(titleCaseCity("NORTH OLMSTED")).toBe("North Olmsted");
  });
  it("keeps mixed-case names with inner capitals and capitalises Mc names in shouting input", () => {
    expect(titleCaseCity("McArthur")).toBe("McArthur");
    expect(titleCaseCity("DeGraff")).toBe("DeGraff");
    expect(titleCaseCity(titleCaseCity("McArthur"))).toBe("McArthur");
    expect(titleCaseCity("MCARTHUR")).toBe("McArthur");
    expect(titleCaseAddress("123 McKinley Ave")).toBe("123 McKinley Ave");
    expect(titleCaseAddress("123 MCKINLEY AVE")).toBe("123 McKinley Ave");
    expect(titleCaseCity("Rocky river")).toBe("Rocky River");
    expect(titleCaseAddress("12 O'BRIEN CT")).toBe("12 O'Brien Ct");
  });
});

describe("houseNumber (reused from score.ts)", () => {
  it("reads the leading number", () => {
    expect(houseNumber("1234 Elm Rd")).toBe(1234);
    expect(houseNumber("Elm Rd")).toBeNull();
  });
});

describe("ownerFirstName", () => {
  it("reads LAST FIRST county strings", () => {
    expect(ownerFirstName("SMITH JOHN & JANE")).toBe("John");
    expect(ownerFirstName("SMITH JOHN")).toBe("John");
    expect(ownerFirstName("SMITH JOHN A")).toBe("John");
    expect(ownerFirstName("SMITH JOHN JR")).toBe("John");
    expect(ownerFirstName("VAN DER BERG MARIA")).toBe("Maria");
  });
  it("reads LAST, FIRST", () => {
    expect(ownerFirstName("SMITH, JOHN")).toBe("John");
    expect(ownerFirstName("SMITH, JOHN & JANE")).toBe("John");
    expect(ownerFirstName("Smith, Maria A")).toBe("Maria");
    expect(ownerFirstName("SMITH JR, JOHN")).toBe("John");
  });
  it("reads FIRST & SECOND LAST", () => {
    expect(ownerFirstName("JOHN & JANE SMITH")).toBe("John");
  });
  it("skips initials and returns null when no first name can be found", () => {
    expect(ownerFirstName("SMITH J ANDREW")).toBe("Andrew");
    expect(ownerFirstName("SMITH J")).toBeNull();
    expect(ownerFirstName("SMITH")).toBeNull();
    expect(ownerFirstName("")).toBeNull();
    expect(ownerFirstName(null)).toBeNull();
  });
  it("never invents a name for companies and trusts", () => {
    expect(ownerFirstName("ACME HOLDINGS LLC")).toBeNull();
    expect(ownerFirstName("LAKEVIEW PROPERTIES INC")).toBeNull();
    expect(ownerFirstName("SMITH FAMILY TRUST")).toBeNull();
    expect(ownerFirstName("SMITH JOHN TR")).toBeNull();
    expect(ownerFirstName("CITY OF ROCKY RIVER")).toBeNull();
  });
});
