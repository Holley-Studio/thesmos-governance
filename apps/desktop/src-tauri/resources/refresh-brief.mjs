// scripts/refresh-brief.ts
import { readFileSync, writeFileSync, renameSync, mkdirSync, lstatSync, unlinkSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

// shared/brief.ts
var object = (x) => {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("Invalid briefing object");
  return x;
};
function stamp(x) {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x) || !Number.isFinite(Date.parse(x))) throw new Error("Invalid briefing timestamp");
  return new Date(x).toISOString();
}
function text(x, max, fallback = "") {
  return typeof x === "string" ? x.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, max) || fallback : fallback;
}
function subject(x, fallback) {
  const label = text(x, 250, fallback);
  if (/\b(?:patient|diagnosis|prescription|medical record|clinical result|password reset|magic link|otp)\b|\b(?:verification|one.time|sign.in|login|authentication).{0,30}\b(?:code|token|password)\b|\byour code\b/i.test(label)) return "Sensitive subject hidden \u2014 open Google";
  return label;
}
function validBriefAccount(x) {
  return typeof x === "string" && x.length < 160 && /^[a-zA-Z0-9._+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(x);
}
function date(x) {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x) || (/* @__PURE__ */ new Date(x + "T00:00:00Z")).toISOString().slice(0, 10) !== x) throw new Error("Invalid all-day date");
  return x;
}
function parseBrief(input, now = Date.now()) {
  const value = object(input);
  if (value.version !== 1 || !validBriefAccount(value.account) || value.timeZone !== "America/Chicago") throw new Error("Unsupported briefing account or version");
  const updatedAt = stamp(value.updatedAt);
  if (Date.parse(updatedAt) > now + 3e5) throw new Error("Briefing clock is ahead");
  const rawWindow = object(value.window);
  const window = { start: stamp(rawWindow.start), end: stamp(rawWindow.end) };
  if (Date.parse(window.end) <= Date.parse(window.start) || Date.parse(window.end) - Date.parse(window.start) > 8 * 864e5) throw new Error("Invalid calendar window");
  const source = (raw, limit, parse, identity) => {
    const data = object(raw);
    if (!["ok", "error"].includes(String(data.status)) || !Array.isArray(data.items) || data.items.length > limit) throw new Error("Invalid briefing source");
    const attemptedAt = stamp(data.attemptedAt);
    const verifiedAt = data.verifiedAt ? stamp(data.verifiedAt) : void 0;
    if (Date.parse(attemptedAt) > now + 3e5 || verifiedAt && (Date.parse(verifiedAt) > Date.parse(attemptedAt) || Date.parse(verifiedAt) > now + 3e5) || data.status === "ok" && !verifiedAt) throw new Error("Invalid source verification");
    const items = data.items.map(parse);
    if (items.length && !verifiedAt || new Set(items.map(identity)).size !== items.length) throw new Error("Unverified or duplicate briefing records");
    return { status: data.status, attemptedAt, verifiedAt, truncated: data.truncated === true, items };
  };
  const mail = source(value.mail, 20, (raw) => {
    const m = object(raw);
    if (typeof m.id !== "string" || !/^[a-fA-F0-9]{1,64}$/.test(m.id) || typeof m.threadId !== "string" || !/^[a-fA-F0-9]{1,64}$/.test(m.threadId)) throw new Error("Invalid mail reference");
    return { id: m.id, threadId: m.threadId, sender: text(m.sender, 180, "Unknown sender"), subject: subject(m.subject, "(No subject)"), receivedAt: stamp(m.receivedAt), unread: m.unread === true, starred: m.starred === true };
  }, (m) => m.id);
  const calendar = source(value.calendar, 30, (raw) => {
    const e = object(raw);
    const id = text(e.id, 250);
    if (!id) throw new Error("Missing calendar reference");
    const allDay = e.allDay === true;
    const start = allDay ? date(e.start) : stamp(e.start);
    const end = allDay ? date(e.end) : stamp(e.end);
    if (end <= start) throw new Error("Calendar end must follow start");
    const response = ["accepted", "tentative", "needsAction", "declined"].includes(String(e.response)) ? e.response : "unknown";
    return { id, title: subject(e.title, "Untitled event"), start, end, allDay, busy: e.busy !== false, response, reference: typeof e.reference === "string" && /^[a-zA-Z0-9_=\-]{1,600}$/.test(e.reference) ? e.reference : void 0 };
  }, (e) => e.id);
  mail.items.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  calendar.items.sort((a, b) => a.start.localeCompare(b.start));
  return { version: 1, account: value.account, timeZone: "America/Chicago", updatedAt, window, mail, calendar };
}
function mergeBriefPull(previous, input) {
  const pull = object(input);
  if (!validBriefAccount(pull.account) || previous && previous.account !== pull.account) throw new Error("Refresh account differs from the verified account");
  const attemptedAt = stamp(pull.attemptedAt);
  const next = (raw, old) => {
    const source = object(raw);
    if (source.status === "ok") return { status: "ok", attemptedAt, verifiedAt: attemptedAt, truncated: source.truncated === true, items: source.items };
    if (source.status !== "error") throw new Error("Invalid refresh result");
    return { status: "error", attemptedAt, verifiedAt: old?.verifiedAt, truncated: old?.truncated ?? false, items: old?.items ?? [] };
  };
  const calendarRaw = object(pull.calendar);
  return parseBrief({
    version: 1,
    account: pull.account,
    timeZone: "America/Chicago",
    updatedAt: attemptedAt,
    window: calendarRaw.status === "ok" || !previous ? pull.window : previous.window,
    mail: next(pull.mail, previous?.mail),
    calendar: next(pull.calendar, previous?.calendar)
  });
}

// scripts/refresh-brief.ts
var arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : void 0;
};
var dataDir = arg("--data-dir");
if (!dataDir || !isAbsolute(dataDir)) throw new Error("Choose an absolute app data directory");
if (process.argv.includes("--window")) {
  const start = /* @__PURE__ */ new Date();
  console.log(JSON.stringify({ start: start.toISOString(), end: new Date(start.getTime() + 7 * 864e5).toISOString() }));
} else {
  const inputFile = arg("--input");
  const folder = join(dataDir, "briefing");
  mkdirSync(folder, { recursive: true });
  if (!inputFile || !isAbsolute(inputFile) || resolve(inputFile) !== resolve(folder, "pull.json")) throw new Error("Stage metadata in briefing/pull.json only");
  if (lstatSync(folder).isSymbolicLink() || lstatSync(inputFile).isSymbolicLink() || !lstatSync(inputFile).isFile() || lstatSync(inputFile).size > 256e3) throw new Error("Invalid metadata staging file");
  const snapshotFile = join(folder, "snapshot.json");
  let previous;
  try {
    const stat = lstatSync(snapshotFile);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 256e3) throw new Error("Invalid snapshot location");
    previous = parseBrief(JSON.parse(readFileSync(snapshotFile, "utf8").replace(/^\uFEFF/, "")));
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  const snapshot = mergeBriefPull(previous, JSON.parse(readFileSync(inputFile, "utf8").replace(/^\uFEFF/, "")));
  if (snapshot.account !== "matthew@holley.studio") throw new Error("This bridge is scoped to the Holley Studio account");
  const temp = join(folder, `snapshot-${randomUUID()}.tmp`);
  writeFileSync(temp, JSON.stringify(snapshot, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  renameSync(temp, snapshotFile);
  unlinkSync(inputFile);
  if (process.argv.includes("--scheduled")) {
    const file = join(folder, "monitor.json");
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || stat.size > 1e4) throw new Error("Invalid monitor file");
    const config = JSON.parse(readFileSync(file, "utf8"));
    if (config.enabled === true) {
      config.firstScheduledRunVerified = config.firstScheduledRunVerified === true || snapshot.mail.status === "ok" && snapshot.calendar.status === "ok";
      config.lastAttemptAt = snapshot.updatedAt;
      const configTemp = file + "." + randomUUID() + ".tmp";
      writeFileSync(configTemp, JSON.stringify(config, null, 2) + "\n", "utf8");
      renameSync(configTemp, file);
    }
  }
  console.log(JSON.stringify({ written: true, mailShown: snapshot.mail.items.length, calendarShown: snapshot.calendar.items.length, mailStatus: snapshot.mail.status, calendarStatus: snapshot.calendar.status, verifiedAt: snapshot.updatedAt }));
}
