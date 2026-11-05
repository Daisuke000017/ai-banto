// 架空データ（seed/demo-reservations.js）から、D1に入れるSQL（seed/demo.sql）を作る。
// 使い方：npm run seed:build
// 泊ごとの表（stay_nights）は、手で書かずに数えるプログラム（src/lib/counting.js）で作る。

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleaners, cleaningAssignments, innProfile, reservations, rooms } from "../seed/demo-reservations.js";
import { stayNightRows } from "../src/lib/counting.js";
import { daysBetween } from "../src/lib/dates.js";

const RES_COLS = [
  "id", "ota", "ota_reservation_no", "guest_name", "checkin_date", "checkout_date", "nights",
  "adults", "children", "infants", "language", "tax_collection", "lodging_tax_collected",
  "nationalities_json", "amount_gross", "room", "status", "cosleep_free", "cancel_fee_amount",
  "guest_changes_json",
];

function sql(v) {
  if (v == null) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`数値が正しくありません: ${v}`);
    return String(v);
  }
  return `'${String(v).replaceAll("'", "''")}'`;
}

function insert(table, cols, row) {
  return `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => sql(row[c])).join(", ")});`;
}

export function buildSeedSql() {
  const lines = [
    "-- 自動生成（npm run seed:build）。手で直さず seed/demo-reservations.js を直す。",
    "-- 中身はすべて架空データ。",
    "DELETE FROM price_level_plans;",
    "DELETE FROM price_event_candidates;",
    "DELETE FROM cleaning_assignments;",
    "DELETE FROM cleaners;",
    "DELETE FROM discrepancies;",
    "DELETE FROM bank_deposits;",
    "DELETE FROM ota_lines;",
    "DELETE FROM ota_payouts;",
    "DELETE FROM uploads;",
    "DELETE FROM column_maps;",
    "DELETE FROM booking_emails;",
    "DELETE FROM stay_nights;",
    "DELETE FROM tax_drafts;",
    "DELETE FROM minpaku_reports;",
    "DELETE FROM reservations;",
    "DELETE FROM rooms;",
    "DELETE FROM inn_profile;",
    "",
    insert("inn_profile", Object.keys(innProfile), innProfile),
    "",
  ];
  for (const r of rooms) lines.push(insert("rooms", ["code", "name", "sort_order"], r));
  lines.push("");
  for (const c of cleaners) lines.push(insert("cleaners", ["id", "name", "sort_order"], c));
  lines.push("");
  for (const r of reservations) {
    lines.push(insert("reservations", RES_COLS, { ...r, nights: daysBetween(r.checkin_date, r.checkout_date) }));
  }
  lines.push("");
  for (const s of stayNightRows(reservations)) {
    lines.push(insert("stay_nights", ["reservation_id", "night", "fiscal_year", "guests"], s));
  }
  lines.push("");
  for (const a of cleaningAssignments) lines.push(insert("cleaning_assignments", ["reservation_id", "date", "room", "cleaner_id"], a));
  return lines.join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = new URL("../seed/demo.sql", import.meta.url);
  writeFileSync(out, buildSeedSql());
  console.log(`作りました: seed/demo.sql（予約 ${reservations.length}件）`);
}
