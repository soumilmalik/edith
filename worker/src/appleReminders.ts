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

// Apple's PROPFIND responses sometimes return an href as a full absolute URL
// (scheme+host+port) and sometimes as a server-relative path - blindly
// prepending the shard origin onto an already-absolute href produces a
// mangled double-URL. Only prepend when it's actually relative.
function resolveUrl(origin: string, href: string): string {
  return /^https?:\/\//i.test(href) ? href : `${origin}${href}`;
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
    resolveUrl(step1.shardOrigin, principalHref),
    email,
    appPassword,
    "0",
    `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><C:calendar-home-set/></prop></propfind>`
  );
  const homeHref = firstHref(multistatusResponses(step2.xml)[0]?.propstat?.prop?.["calendar-home-set"]);
  if (!homeHref) throw new Error("Could not discover calendar-home-set");

  // 3. List collections, find one that supports VTODO (a Reminders list).
  const homeUrl = resolveUrl(step2.shardOrigin, homeHref);
  const step3 = await propfind(
    homeUrl,
    email,
    appPassword,
    "1",
    `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><resourcetype/><displayname/><C:supported-calendar-component-set/></prop></propfind>`
  );
  // Compares via the URL object (not raw strings) so an explicit ":443" vs
  // an omitted default port - which Apple's server is inconsistent about
  // across these two responses - doesn't cause a false "different URL".
  const normalize = (u: string) => {
    try {
      const x = new URL(u);
      return x.origin + x.pathname.replace(/\/?$/, "/");
    } catch {
      return u;
    }
  };
  let chosen: { shardOrigin: string; collectionUrl: string } | null = null;
  const seen: string[] = [];
  for (const r of multistatusResponses(step3.xml)) {
    const href = firstHref(r);
    if (!href) continue;
    const url = resolveUrl(step3.shardOrigin, href);
    const prop = r?.propstat?.prop || {};
    const comps = prop["supported-calendar-component-set"]?.comp;
    const compList = Array.isArray(comps) ? comps : comps ? [comps] : [];
    const compNames = compList.map((c: any) => c?.["@_name"]).filter(Boolean);
    const isSelf = normalize(url) === normalize(homeUrl);
    const displayName = typeof prop.displayname === "string" ? prop.displayname : prop.displayname?.["#text"] || "";
    seen.push(
      `href=${url} name="${displayName}" comps=[${compNames.join(",")}] resourcetype=${JSON.stringify(prop.resourcetype)}${isSelf ? " SELF" : ""}`
    );
    // Depth:1 also returns the home-set container itself as one of the
    // entries (a self-reference) - PUTing a VTODO directly into that
    // umbrella folder is invalid, it has to go in an actual child list.
    if (!chosen && !isSelf && compNames.includes("VTODO")) {
      chosen = { shardOrigin: step3.shardOrigin, collectionUrl: url };
    }
  }
  // Always logged (not just on failure) - the first successful write landed
  // somewhere Apple accepted (2xx) but that never actually showed up in
  // Reminders, so seeing every candidate is the only way to tell which one
  // is genuinely the reminders list vs. a calendar that merely also
  // advertises VTODO support.
  console.log(`Apple CalDAV collections under ${homeUrl}:\n${seen.join("\n")}\nChosen: ${chosen?.collectionUrl || "none"}`);
  if (!chosen) throw new Error(`No VTODO-capable child list found. Collections seen: ${seen.join(" | ") || "(none)"}`);
  return chosen;
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
  const { collectionUrl } = await discoverTodoCollection(email, appPassword);
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

  const putUrl = `${collectionUrl.replace(/\/?$/, "/")}${uid}.ics`;
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
