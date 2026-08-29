import { XMLParser } from "fast-xml-parser";

// Pushes a reminder into the user's real Apple Reminders app via iCloud's
// CalDAV server (RFC 4791). Apple has no REST/JSON API for Reminders -
// CalDAV is the only official route. Uses an app-specific password (Basic
// Auth), never the real Apple ID password.

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

function authHeader(email: string, appPassword: string): string {
  return "Basic " + btoa(`${email}:${appPassword}`);
}

async function propfind(url: string, email: string, appPassword: string, depth: string, body: string) {
  const res = await fetch(url, {
    method: "PROPFIND",
    headers: {
      Authorization: authHeader(email, appPassword),
      Depth: depth,
      "Content-Type": "application/xml; charset=utf-8",
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`CalDAV PROPFIND ${url} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  // fetch() follows redirects automatically; res.url is the actual shard
  // this landed on (Apple auto-assigns accounts to a pNN-caldav.icloud.com
  // shard) - every subsequent request must target that same shard, not the
  // generic caldav.icloud.com entrypoint (which would just redirect again).
  const shardOrigin = new URL(res.url).origin;
  return { xml: parser.parse(text), shardOrigin };
}

function multistatusResponses(xml: any): any[] {
  const ms = xml?.multistatus;
  if (!ms) return [];
  const responses = ms.response;
  return Array.isArray(responses) ? responses : responses ? [responses] : [];
}

function firstHref(node: any): string | null {
  const href = node?.href;
  if (!href) return null;
  return typeof href === "string" ? href : href["#text"] || null;
}

async function discoverTodoCollection(email: string, appPassword: string) {
  // 1. Who am I?
  const step1 = await propfind(
    "https://caldav.icloud.com/",
    email,
    appPassword,
    "0",
    `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>`
  );
  const principalHref = firstHref(multistatusResponses(step1.xml)[0]?.propstat?.prop?.["current-user-principal"]);
  if (!principalHref) throw new Error("Could not discover CalDAV principal (check Apple ID email / app password)");

  // 2. Where do my calendars/reminders live?
  const step2 = await propfind(
    `${step1.shardOrigin}${principalHref}`,
    email,
    appPassword,
    "0",
    `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><C:calendar-home-set/></prop></propfind>`
  );
  const homeHref = firstHref(multistatusResponses(step2.xml)[0]?.propstat?.prop?.["calendar-home-set"]);
  if (!homeHref) throw new Error("Could not discover calendar-home-set");

  // 3. List collections, find one that supports VTODO (a Reminders list).
  const step3 = await propfind(
    `${step2.shardOrigin}${homeHref}`,
    email,
    appPassword,
    "1",
    `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><resourcetype/><displayname/><C:supported-calendar-component-set/></prop></propfind>`
  );
  for (const r of multistatusResponses(step3.xml)) {
    const comps = r?.propstat?.prop?.["supported-calendar-component-set"]?.comp;
    const compList = Array.isArray(comps) ? comps : comps ? [comps] : [];
    const supportsTodo = compList.some((c: any) => c?.["@_name"] === "VTODO");
    if (supportsTodo) {
      const href = firstHref(r);
      if (href) return { shardOrigin: step3.shardOrigin, collectionHref: href };
    }
  }
  throw new Error("No VTODO-capable (Reminders) collection found in this iCloud account");
}

function icsEscape(text: string): string {
  return String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toIcsDateTime(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export async function createAppleReminder(
  email: string,
  appPassword: string,
  { text, dueAt }: { text: string; dueAt?: string }
): Promise<{ ok: true }> {
  const { shardOrigin, collectionHref } = await discoverTodoCollection(email, appPassword);
  const uid = crypto.randomUUID();
  const now = toIcsDateTime(new Date().toISOString());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Edith//Reminders//EN",
    "BEGIN:VTODO",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${icsEscape(text)}`,
  ];
  if (dueAt) lines.push(`DUE:${toIcsDateTime(dueAt)}`);
  lines.push("STATUS:NEEDS-ACTION", "END:VTODO", "END:VCALENDAR");
  const ics = lines.join("\r\n");

  const putUrl = `${shardOrigin}${collectionHref}${uid}.ics`;
  const res = await fetch(putUrl, {
    method: "PUT",
    headers: {
      Authorization: authHeader(email, appPassword),
      "Content-Type": "text/calendar; charset=utf-8",
    },
    body: ics,
  });
  if (!res.ok) {
    throw new Error(`CalDAV PUT ${putUrl} -> ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  return { ok: true };
}
