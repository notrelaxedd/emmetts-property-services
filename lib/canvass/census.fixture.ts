/**
 * Small ACS group-metadata fixtures (the shape of `/data/<vintage>/acs/acs5/groups/<table>.json`, trimmed to the
 * variables the code looks for plus a few decoys) and a 2-row data response. Labels follow the Census API's
 * "Estimate!!Total:!!…" convention. Test data only.
 */
import type { AcsGroupJson } from "./census";

const est = (label: string) => ({ label, concept: "", predicateType: "int", group: "" });
const moe = (label: string) => ({ label: label.replace(/^Estimate/, "Margin of Error"), concept: "", predicateType: "int", group: "" });

/** B08302 — Time leaving home to go to work (every bucket, with margin-of-error and annotation decoys). */
export const groupB08302: AcsGroupJson = {
  variables: {
    B08302_001E: est("Estimate!!Total:"),
    B08302_001M: moe("Estimate!!Total:"),
    B08302_001EA: { label: "Annotation of Estimate!!Total:" },
    B08302_002E: est("Estimate!!Total:!!12:00 a.m. to 4:59 a.m."),
    B08302_003E: est("Estimate!!Total:!!5:00 a.m. to 5:29 a.m."),
    B08302_004E: est("Estimate!!Total:!!5:30 a.m. to 5:59 a.m."),
    B08302_005E: est("Estimate!!Total:!!6:00 a.m. to 6:29 a.m."),
    B08302_006E: est("Estimate!!Total:!!6:30 a.m. to 6:59 a.m."),
    B08302_007E: est("Estimate!!Total:!!7:00 a.m. to 7:29 a.m."),
    B08302_008E: est("Estimate!!Total:!!7:30 a.m. to 7:59 a.m."),
    B08302_009E: est("Estimate!!Total:!!8:00 a.m. to 8:29 a.m."),
    B08302_010E: est("Estimate!!Total:!!8:30 a.m. to 8:59 a.m."),
    B08302_011E: est("Estimate!!Total:!!9:00 a.m. to 9:59 a.m."),
    B08302_012E: est("Estimate!!Total:!!10:00 a.m. to 10:59 a.m."),
    B08302_013E: est("Estimate!!Total:!!11:00 a.m. to 11:59 a.m."),
    B08302_014E: est("Estimate!!Total:!!12:00 p.m. to 3:59 p.m."),
    B08302_015E: est("Estimate!!Total:!!4:00 p.m. to 11:59 p.m."),
  },
};

/** B08303 — Travel time to work. */
export const groupB08303: AcsGroupJson = {
  variables: {
    B08303_001E: est("Estimate!!Total:"),
    B08303_001M: moe("Estimate!!Total:"),
    B08303_002E: est("Estimate!!Total:!!Less than 5 minutes"),
    B08303_003E: est("Estimate!!Total:!!5 to 9 minutes"),
    B08303_004E: est("Estimate!!Total:!!10 to 14 minutes"),
    B08303_005E: est("Estimate!!Total:!!15 to 19 minutes"),
    B08303_006E: est("Estimate!!Total:!!20 to 24 minutes"),
    B08303_007E: est("Estimate!!Total:!!25 to 29 minutes"),
    B08303_008E: est("Estimate!!Total:!!30 to 34 minutes"),
    B08303_009E: est("Estimate!!Total:!!35 to 39 minutes"),
    B08303_010E: est("Estimate!!Total:!!40 to 44 minutes"),
    B08303_011E: est("Estimate!!Total:!!45 to 59 minutes"),
    B08303_012E: est("Estimate!!Total:!!60 to 89 minutes"),
    B08303_013E: est("Estimate!!Total:!!90 or more minutes"),
  },
};

/** B23025 — Employment status for the population 16 years and over. */
export const groupB23025: AcsGroupJson = {
  variables: {
    B23025_001E: est("Estimate!!Total:"),
    B23025_002E: est("Estimate!!Total:!!In labor force:"),
    B23025_003E: est("Estimate!!Total:!!In labor force:!!Civilian labor force:"),
    B23025_004E: est("Estimate!!Total:!!In labor force:!!Civilian labor force:!!Employed"),
    B23025_005E: est("Estimate!!Total:!!In labor force:!!Civilian labor force:!!Unemployed"),
    B23025_006E: est("Estimate!!Total:!!In labor force:!!Armed Forces"),
    B23025_007E: est("Estimate!!Total:!!Not in labor force"),
    B23025_007M: moe("Estimate!!Total:!!Not in labor force"),
  },
};

/** B01001 — Sex by age (trimmed to the 60+ buckets and a few younger decoys). */
export const groupB01001: AcsGroupJson = {
  variables: {
    B01001_001E: est("Estimate!!Total:"),
    B01001_002E: est("Estimate!!Total:!!Male:"),
    B01001_003E: est("Estimate!!Total:!!Male:!!Under 5 years"),
    B01001_019E: est("Estimate!!Total:!!Male:!!62 to 64 years"),
    B01001_020E: est("Estimate!!Total:!!Male:!!65 and 66 years"),
    B01001_021E: est("Estimate!!Total:!!Male:!!67 to 69 years"),
    B01001_022E: est("Estimate!!Total:!!Male:!!70 to 74 years"),
    B01001_023E: est("Estimate!!Total:!!Male:!!75 to 79 years"),
    B01001_024E: est("Estimate!!Total:!!Male:!!80 to 84 years"),
    B01001_025E: est("Estimate!!Total:!!Male:!!85 years and over"),
    B01001_026E: est("Estimate!!Total:!!Female:"),
    B01001_027E: est("Estimate!!Total:!!Female:!!Under 5 years"),
    B01001_043E: est("Estimate!!Total:!!Female:!!62 to 64 years"),
    B01001_044E: est("Estimate!!Total:!!Female:!!65 and 66 years"),
    B01001_045E: est("Estimate!!Total:!!Female:!!67 to 69 years"),
    B01001_046E: est("Estimate!!Total:!!Female:!!70 to 74 years"),
    B01001_047E: est("Estimate!!Total:!!Female:!!75 to 79 years"),
    B01001_048E: est("Estimate!!Total:!!Female:!!80 to 84 years"),
    B01001_049E: est("Estimate!!Total:!!Female:!!85 years and over"),
  },
};

/** B23007 — Presence of own children under 18 by family type by employment status of parents. */
export const groupB23007: AcsGroupJson = {
  variables: {
    B23007_001E: est("Estimate!!Total:"),
    B23007_002E: est("Estimate!!Total:!!With own children of the householder under 18 years:"),
    B23007_003E: est("Estimate!!Total:!!With own children of the householder under 18 years:!!Married-couple family:"),
    B23007_004E: est("Estimate!!Total:!!With own children of the householder under 18 years:!!Married-couple family:!!Both parents in labor force"),
    B23007_005E: est("Estimate!!Total:!!With own children of the householder under 18 years:!!Married-couple family:!!Father only in labor force"),
    B23007_006E: est("Estimate!!Total:!!With own children of the householder under 18 years:!!Married-couple family:!!Mother only in labor force"),
    B23007_007E: est("Estimate!!Total:!!With own children of the householder under 18 years:!!Married-couple family:!!Neither parent in labor force"),
    B23007_008E: est("Estimate!!Total:!!With own children of the householder under 18 years:!!Other family:"),
    B23007_009E: est("Estimate!!Total:!!With own children of the householder under 18 years:!!Other family:!!Male householder, no spouse present:"),
    B23007_010E: est("Estimate!!Total:!!With own children of the householder under 18 years:!!Other family:!!Male householder, no spouse present:!!In labor force"),
    B23007_011E: est("Estimate!!Total:!!With own children of the householder under 18 years:!!Other family:!!Male householder, no spouse present:!!Not in labor force"),
    B23007_012E: est("Estimate!!Total:!!With own children of the householder under 18 years:!!Other family:!!Female householder, no spouse present:"),
    B23007_013E: est("Estimate!!Total:!!With own children of the householder under 18 years:!!Other family:!!Female householder, no spouse present:!!In labor force"),
    B23007_014E: est("Estimate!!Total:!!With own children of the householder under 18 years:!!Other family:!!Female householder, no spouse present:!!Not in labor force"),
    B23007_015E: est("Estimate!!Total:!!No own children of the householder under 18 years:"),
    B23007_016E: est("Estimate!!Total:!!No own children of the householder under 18 years:!!Married-couple family:"),
    B23007_017E: est("Estimate!!Total:!!No own children of the householder under 18 years:!!Married-couple family:!!Both parents in labor force"),
    B23007_020E: est("Estimate!!Total:!!No own children of the householder under 18 years:!!Married-couple family:!!Neither parent in labor force"),
    B23007_024E: est("Estimate!!Total:!!No own children of the householder under 18 years:!!Other family:!!Male householder, no spouse present:!!Not in labor force"),
  },
};

/** B19013 — Median household income. */
export const groupB19013: AcsGroupJson = {
  variables: {
    B19013_001E: est("Estimate!!Median household income in the past 12 months (in 2023 inflation-adjusted dollars)"),
    B19013_001M: moe("Estimate!!Median household income in the past 12 months (in 2023 inflation-adjusted dollars)"),
  },
};

export const allGroups = {
  B08302: groupB08302,
  B08303: groupB08303,
  B23025: groupB23025,
  B01001: groupB01001,
  B23007: groupB23007,
  B19013: groupB19013,
} as const;

/** Two Rocky River-area block groups (tract 1621.02 block groups 1 and 2; counts invented). */
export const GEOID_A = "390351621021";
export const GEOID_B = "390351621022";

/** A data response for one table, in the API's array-of-arrays shape, header row first. */
export function dataResponse(ids: string[], rowsByGeoid: Record<string, (number | string | null)[]>): (string | number | null)[][] {
  const header = ["NAME", ...ids, "state", "county", "tract", "block group"];
  const rows = Object.entries(rowsByGeoid).map(([geoid, values]) => [
    `Block Group ${geoid.slice(11)}; Census Tract ${geoid.slice(5, 9)}.${geoid.slice(9, 11)}; Cuyahoga County; Ohio`,
    ...values,
    geoid.slice(0, 2),
    geoid.slice(2, 5),
    geoid.slice(5, 11),
    geoid.slice(11),
  ]);
  return [header, ...rows];
}

/** Per-table values for the two block groups, keyed by the variable ids the fixtures define. */
export const dataFixtures: Record<string, Record<string, (number | string | null)[]>> = {
  // total, 12-5am, 5:00, 5:30, 6:00, 6:30, 7:00, 7:30, 8:00, 8:30, 9, 10, 11, 12p-4p, 4p-12a
  B08302: {
    [GEOID_A]: [400, 10, 10, 15, 30, 40, 70, 80, 60, 30, 20, 10, 5, 10, 10],
    [GEOID_B]: [200, 5, 5, 5, 10, 15, 30, 25, 40, 30, 15, 5, 5, 5, 5],
  },
  // total, <5, 5-9, 10-14, 15-19, 20-24, 25-29, 30-34, 35-39, 40-44, 45-59, 60-89, 90+
  B08303: {
    [GEOID_A]: [400, 10, 30, 50, 60, 80, 60, 50, 20, 15, 15, 7, 3],
    [GEOID_B]: [200, 5, 10, 20, 30, 40, 35, 30, 15, 5, 5, 3, 2],
  },
  // total, not in labor force
  B23025: {
    [GEOID_A]: [900, 420],
    [GEOID_B]: [500, -666666666],
  },
  // total, M65-66, M67-69, M70-74, M75-79, M80-84, M85+, F65-66, F67-69, F70-74, F75-79, F80-84, F85+
  B01001: {
    [GEOID_A]: [1100, 20, 25, 40, 30, 20, 10, 25, 30, 45, 35, 25, 20],
    [GEOID_B]: [600, 5, 5, 10, 5, 5, 2, 5, 8, 10, 8, 5, 4],
  },
  // total families, families with kids, father only, mother only, neither, male hh not in LF, female hh not in LF
  B23007: {
    [GEOID_A]: [500, 200, 40, 20, 5, 2, 8],
    [GEOID_B]: [300, 100, 10, 5, 0, 0, 5],
  },
  // median income
  B19013: {
    [GEOID_A]: ["98750"],
    [GEOID_B]: [-666666666],
  },
};
