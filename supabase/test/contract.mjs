#!/usr/bin/env node
// Contract check: compares the migrated database with lib/db/types.ts.
//   node supabase/test/contract.mjs <postgres-url>
// Verifies every enum (labels + order), table (exact column set + nullability),
// the crew_jobs view (exact column set) and the typed functions (argument names).
// Exits 1 on any mismatch. No dependencies: types.ts is parsed with a small
// brace-aware scanner, the database is read through psql.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dbUrl = process.argv[2];
if (!dbUrl) {
  console.error("usage: contract.mjs <postgres-url>");
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const src = readFileSync(resolve(root, "lib/db/types.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

// Text between the brace that opens at `from` and its matching close.
function block(text, from) {
  const open = text.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}
// Top-level `key?: type;` members of an object-type body -> [{ key, type }].
function members(body) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (ch === "{" || ch === "(" || ch === "<" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === ">" || ch === "]") depth--;
    else if ((ch === ";" && depth === 0) || i === body.length) {
      const part = body.slice(start, i).trim();
      start = i + 1;
      const m = part.match(/^(\w+)\??\s*:\s*([\s\S]+)$/);
      if (m) out.push({ key: m[1], type: m[2].replace(/\s+/g, " ") });
    }
  }
  return out;
}
const section = (name, within = src) => block(within, within.search(new RegExp(`\\b${name}\\s*:\\s*\\{`)));
const typeBody = (name) => {
  const at = src.search(new RegExp(`export type ${name}\\s*=`));
  if (at < 0) throw new Error(`type ${name} not found`);
  return src.slice(at, src.indexOf(";", at) + 1);
};
const psql = (sql) =>
  execFileSync("psql", ["-X", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", dbUrl, "-c", sql], { encoding: "utf8" })
    .split("\n").filter(Boolean).map((l) => l.split("\t"));

const failures = [];
let checks = 0;
const expect = (ok, msg) => { checks++; if (!ok) failures.push(msg); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- enums
const dbEnums = {};
for (const [name, label] of psql(`select t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid
                                   join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public'
                                   order by t.typname, e.enumsortorder`)) (dbEnums[name] ??= []).push(label);
for (const { key, type } of members(section("Enums"))) {
  const labels = [...typeBody(type).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  expect(same(dbEnums[key], labels), `enum ${key}: db=${JSON.stringify(dbEnums[key])} ts=${JSON.stringify(labels)}`);
}

// ---- tables
const dbCols = {};
for (const [table, col, nullable] of psql(`select table_name, column_name, is_nullable from information_schema.columns
                                           where table_schema = 'public' order by table_name, ordinal_position`))
  (dbCols[table] ??= {})[col] = nullable === "YES";
const tsTables = members(section("Tables"));
for (const { key: table, type } of tsTables) {
  const typeName = type.match(/Table<(\w+)>/)[1];
  const def = src.slice(src.search(new RegExp(`export type ${typeName}\\s*=`)));
  const cols = [
    { key: "id", type: "string" }, { key: "created_at", type: "string" }, { key: "updated_at", type: "string" },
    ...members(block(def, 0)),
  ];
  const db = dbCols[table];
  if (!db) { expect(false, `table ${table} missing`); continue; }
  const tsNames = cols.map((c) => c.key).sort(), dbNames = Object.keys(db).sort();
  expect(same(tsNames, dbNames), `table ${table} columns differ: only in ts=${tsNames.filter((c) => !db[c] && db[c] !== false)} only in db=${dbNames.filter((c) => !tsNames.includes(c))}`);
  for (const c of cols) {
    if (!(c.key in db)) continue;
    const tsNullable = /\|\s*null\b/.test(c.type) || /^null\s*\|/.test(c.type);
    expect(db[c.key] === tsNullable, `${table}.${c.key}: db nullable=${db[c.key]} ts nullable=${tsNullable}`);
  }
}
const dbTables = psql(`select tablename from pg_tables where schemaname = 'public'`).map((r) => r[0]).sort();
expect(same(dbTables, tsTables.map((t) => t.key).sort()), `table list differs: db=${dbTables}`);

// ---- views
const views = section("Views");
const crewRow = members(block(views, views.search(/Row\s*:\s*\{/))).map((m) => m.key);
expect(same(Object.keys(dbCols.crew_jobs ?? {}), crewRow), `view crew_jobs columns: db=${Object.keys(dbCols.crew_jobs ?? {})} ts=${crewRow}`);

// ---- functions
const dbFns = Object.fromEntries(psql(`select p.proname, coalesce(array_to_string(p.proargnames, ','), '') from pg_proc p
                                       join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`));
for (const { key: fn, type } of members(section("Functions"))) {
  const argsBody = type.match(/Args\s*:\s*\{([^}]*)\}/);
  const args = argsBody ? members(argsBody[1]).map((m) => m.key) : [];
  expect(fn in dbFns, `function ${fn} missing`);
  if (fn in dbFns) expect(same((dbFns[fn] || "").split(",").filter(Boolean), args), `function ${fn} args: db=${dbFns[fn]} ts=${args}`);
}

if (failures.length) {
  console.error(`contract: ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.error("  NOT OK - " + f);
  process.exit(1);
}
console.log(`ok - schema matches lib/db/types.ts (${checks} checks: ${Object.keys(dbEnums).length} enums, ${tsTables.length} tables, crew_jobs view, functions)`);
