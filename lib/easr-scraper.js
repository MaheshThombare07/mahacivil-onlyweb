/**
 * eASR scraper — HTTP only (no Chromium / Playwright).
 * Talks to the Maharashtra IGR ASP.NET WebForms portal via POST postbacks.
 */
const dns = require("dns");
const { spawn } = require("child_process");
const path = require("path");
const cheerio = require("cheerio");
const { CookieJar } = require("tough-cookie");
const cache = require("./cache");
const staticLocations = require("./static-locations");

let undiciAgent = null;
try {
    const { Agent } = require("undici");
    undiciAgent = new Agent({
        connect: { timeout: 60_000 },
        headersTimeout: 120_000,
        bodyTimeout: 120_000,
    });
} catch (_) {
    /* Node without undici Agent export */
}

dns.setDefaultResultOrder("ipv4first");

const EASR_URL = "https://easr.igrmaharashtra.gov.in/eASRCommon.aspx?hDistName=Aurangabad";
const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const RATES_ATTEMPT_TIMEOUT_MS = 60_000;
const RATES_SERVER_ATTEMPTS = 2;
const SCRAPE_TIMEOUT_MS = 45_000;
const POSTBACK_DELAY_MS = 500;
const CACHE_TTL_RATES = 30 * 60 * 1000;
const CACHE_TTL_TALUKAS = 3600_000;
const CACHE_TTL_VILLAGES = 1800_000;
const PYTHON_SCRIPT = path.join(__dirname, "..", "scripts", "easr_http_scrape.py");
const MAX_SURVEY_NUMBERS = 50;

// Column keyword detection for all eASR table formats (urban + rural)
const COLUMN_MAP_KEYWORDS = {
    // Rural tables use 'विभाग नं.' for the zone identifier column
    zoneNo:      ['विभाग नं', 'zone no', 'vibhag no'],
    subzone:     ['उपविभाग', 'sub zone', 'sub-zone'],
    // Urban multi-column: separate columns per property type
    openLand:    ['खुली जमीन', 'open land', 'open plot'],
    residential: ['निवासी', 'resident', 'सदनिका'],
    office:      ['ऑफिस', 'ऑफीस', 'office'],
    shop:        ['दुकाने', 'दुकान', 'shop'],
    industrial:  ['औद्योगिक', 'industrial'],
    unit:        ['एकक', 'unit', 'rs./'],
    // Rural tables use 'दर' (generic single rate column)
    rate:        ['दर'],
};

class ScraperError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.statusCode = statusCode;
    }
}

function normalize(text) {
    return staticLocations.normalizeName(text);
}

class EasrSession {
    constructor(timeoutMs) {
        this.jar = new CookieJar();
        this.timeoutMs = timeoutMs;
    }

    async request(url, { method = "GET", body = null } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const cookie = await this.jar.getCookieString(url);
            const headers = {
                "User-Agent": USER_AGENT,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-IN,en;q=0.9",
                Referer: EASR_URL,
            };
            if (cookie) headers.Cookie = cookie;
            if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";

            const res = await fetch(url, {
                method,
                headers,
                body,
                signal: controller.signal,
                redirect: "follow",
                dispatcher: undiciAgent || undefined,
            });
            const setCookies =
                typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
            for (const raw of setCookies) {
                await this.jar.setCookie(raw, url);
            }
            if (!res.ok) {
                throw new ScraperError(`eASR portal returned HTTP ${res.status}.`, 502);
            }
            return await res.text();
        } catch (err) {
            if (err.name === "AbortError") {
                throw new ScraperError("Government website timed out.", 504);
            }
            const cause = err.cause || err;
            if (cause.code === "UND_ERR_CONNECT_TIMEOUT" || /connect timeout/i.test(cause.message || "")) {
                throw new ScraperError(
                    "Cannot reach the government eASR portal from this server. Deploy the Python API (server_http.py) on an Indian VPS, not Render US.",
                    504
                );
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    get(url) {
        return this.request(url, { method: "GET" });
    }

    post(url, fields) {
        return this.request(url, {
            method: "POST",
            body: new URLSearchParams(fields).toString(),
        });
    }
}

function createClient(timeoutMs = SCRAPE_TIMEOUT_MS) {
    return new EasrSession(timeoutMs);
}

function parseRate(value) {
    const cleaned = String(value || "").replace(/[^\d]/g, "");
    if (!cleaned) return 0;
    return parseInt(cleaned, 10);
}

function isRateLike(value) {
    const cleaned = String(value || "").replace(/[^\d]/g, "");
    return Boolean(cleaned) && /^\d+$/.test(cleaned);
}

function isRangeLike(value) {
    if (!value) return false;
    return /\d/.test(value) && (value.includes("-") || value.includes("–") || /to/i.test(value));
}

function isPlaceholderOption(text, kind) {
    const t = text.toLowerCase();
    if (!text || text.startsWith("- -") || text === "--") return true;
    if (kind === "taluka" && t.includes("select taluka")) return true;
    if (kind === "village" && t.includes("select village")) return true;
    if (kind === "survey" && (t.includes("select") || t.includes("--"))) return true;
    return false;
}

function isHeaderRow(cells) {
    const joined = cells.join(" ").toLowerCase();
    if (joined.includes("assessment type") && joined.includes("rate rs")) return true;
    if (cells.length && normalize(cells[0]) === "assessment type") return true;
    if (cells.length && normalize(cells[0]) === "मूल्यांकन प्रकार") return true;
    return false;
}

function isPagerRow(cells) {
    if (!cells.length) return true;
    if (cells.every((c) => /^\d+$/.test(c))) return true;
    return cells.join(" ").toLowerCase().includes("page:");
}

function getSelectedOptionValue($, selectEl) {
    let selected = $(selectEl).find("option[selected]").first();
    if (!selected.length) selected = $(selectEl).find("option").filter((_, opt) => $(opt).attr("selected") !== undefined).first();
    if (!selected.length) selected = $(selectEl).find("option:selected").first();
    if (!selected.length) selected = $(selectEl).find("option").first();
    return selected.attr("value") || "";
}

function collectHiddenFields($) {
    const fields = {};
    $("input, textarea").each((_, el) => {
        const name = $(el).attr("name");
        if (!name) return;
        const tag = (el.tagName || $(el).prop("tagName") || "").toLowerCase();
        if (tag === "textarea") {
            fields[name] = $(el).text() || "";
            return;
        }
        const type = ($(el).attr("type") || "text").toLowerCase();
        if (type === "checkbox" || type === "radio") {
            if ($(el).attr("checked") !== undefined) fields[name] = $(el).attr("value") || "on";
        } else {
            fields[name] = $(el).attr("value") || "";
        }
    });
    $("select").each((_, el) => {
        const name = $(el).attr("name");
        if (!name) return;
        fields[name] = getSelectedOptionValue($, el);
    });
    return fields;
}

function findSelect($, suffix) {
    const el = $(`select[id$="${suffix}"]`).first();
    if (!el.length) return null;
    return el;
}

function readSelectOptions($, suffix, kind) {
    const select = findSelect($, suffix);
    if (!select || !select.length) {
        throw new ScraperError(`Dropdown not found: ${suffix}`, 404);
    }
    const options = [];
    select.find("option").each((_, opt) => {
        const text = normalize($(opt).text());
        const value = $(opt).attr("value") || "";
        if (!text || !value || value === "0" || value === "-1") return;
        if (isPlaceholderOption(text, kind)) return;
        options.push({ text, value });
    });
    return { select, options };
}

function matchOption(options, target) {
    const targetNorm = normalize(target);
    const targetKey = staticLocations.normalizeMatchKey(target);

    let match = options.find((o) => normalize(o.text) === targetNorm);
    if (match) return match;

    match = options.find((o) => staticLocations.normalizeMatchKey(o.text) === targetKey);
    if (match) return match;

    match = options.find((o) => {
        const text = normalize(o.text);
        const textKey = staticLocations.normalizeMatchKey(o.text);
        return text.includes(targetNorm) || targetNorm.includes(text)
            || textKey.includes(targetKey) || targetKey.includes(textKey);
    });
    if (!match) {
        const sample = options.slice(0, 8).map((o) => o.text);
        throw new ScraperError(`No matching option for '${target}'. Sample: ${sample.join(", ")}`, 404);
    }
    return match;
}

async function fetchHtml(client, url, fields) {
    return client.post(url, fields);
}

async function openSession(client) {
    const html = await client.get(EASR_URL);
    const $ = cheerio.load(html);
    if (!findSelect($, "ddlTaluka")) {
        throw new ScraperError("eASR portal did not return taluka dropdown.", 502);
    }
    return $;
}

async function postSelectChange(client, $, suffix, target, kind) {
    const { select, options } = readSelectOptions($, suffix, kind);
    const match = matchOption(options, target);
    const name = select.attr("name");
    if (!name) throw new ScraperError(`Missing name on ${suffix}`, 500);

    const fields = collectHiddenFields($);
    fields[name] = match.value;
    fields.__EVENTTARGET = name;
    fields.__EVENTARGUMENT = "";

    const html = await fetchHtml(client, EASR_URL, fields);
    await delay(POSTBACK_DELAY_MS);
    return cheerio.load(html);
}

function findSurveyDropdown($) {
    const skipPatterns = ["ddltaluka", "ddlvillage"];
    let best = null;
    let bestCount = 0;

    $("select").each((_, el) => {
        const id = ($(el).attr("id") || "").toLowerCase();
        const name = ($(el).attr("name") || "").toLowerCase();
        const combined = id + name;
        if (skipPatterns.some((p) => combined.includes(p))) return;

        let valid = 0;
        $(el).find("option").each((__, opt) => {
            const val = $(opt).attr("value") || "";
            const text = normalize($(opt).text());
            if (!val || val === "0" || val === "-1") return;
            if (isPlaceholderOption(text, "survey")) return;
            valid++;
        });

        if (valid > 0 && valid > bestCount) {
            bestCount = valid;
            best = el;
        }
    });

    if (!best) return null;
    return $(best);
}

function readSurveyOptions($, selectEl) {
    const options = [];
    selectEl.find("option").each((_, opt) => {
        const text = normalize($(opt).text());
        const value = $(opt).attr("value") || "";
        if (!text || !value || value === "0" || value === "-1") return;
        if (isPlaceholderOption(text, "survey")) return;
        options.push({ text, value });
    });
    return options;
}

async function postSurveyChange(client, $, selectEl, targetValue) {
    const name = selectEl.attr("name");
    if (!name) throw new ScraperError("Missing name on survey dropdown", 500);

    const fields = collectHiddenFields($);
    fields[name] = targetValue;
    fields.__EVENTTARGET = name;
    fields.__EVENTARGUMENT = "";

    const html = await fetchHtml(client, EASR_URL, fields);
    await delay(POSTBACK_DELAY_MS);
    return cheerio.load(html);
}

function parseDataRow(cells, pageVibhag) {
    const texts = cells.map((c) => normalize(c)).filter(Boolean);
    if (!texts.length || isHeaderRow(texts)) return null;

    let vibhag = pageVibhag;
    let assessmentType = "";
    let assessmentRange = "";
    let rate = 0;
    let unit = "";

    if (texts.length >= 4 && /^\d+$/.test(texts[0])) {
        vibhag = parseInt(texts[0], 10);
        assessmentType = texts[1];
        if (isRangeLike(texts[2])) {
            assessmentRange = texts[2];
            rate = parseRate(texts[3]);
            unit = texts[4] || "";
        } else if (isRateLike(texts[2])) {
            rate = parseRate(texts[2]);
            unit = texts[3] || "";
        } else {
            assessmentRange = texts[2];
            rate = parseRate(texts[3]);
            unit = texts[4] || "";
        }
    } else if (texts.length >= 3) {
        assessmentType = texts[0];
        if (isRangeLike(texts[1])) {
            assessmentRange = texts[1];
            rate = parseRate(texts[2]);
            unit = texts[3] && !isRateLike(texts[3]) ? texts[3] : "";
        } else if (isRateLike(texts[1]) && texts.length >= 3) {
            rate = parseRate(texts[1]);
            unit = texts[2] || "";
        } else {
            assessmentRange = texts[1];
            rate = parseRate(texts[2]);
            unit = texts[3] || "";
        }
    } else {
        return null;
    }

    if (!assessmentType) return null;
    return { vibhagNo: vibhag, assessmentType, assessmentRange, rate, unit };
}

function findRateTable($) {
    const exactSelectors = [
        "table#gvValuationZone",
        'table[id$="gvValuationZone"]',
        'table[id$="ruralDataGrid"]',
        'table[id$="urbanDataGrid"]',
        'table[id$="grdUrbanSubZoneWiseRate"]',
        'table[id$="grdRuralSubZoneWiseRate"]',
        'table[id$="grdSubZoneWiseRate"]',
    ];
    for (const sel of exactSelectors) {
        const table = $(sel).first();
        if (table.length) return table;
    }
    // Fallback: any GridView table with "Rate" in its ID
    const fallback = $('table[id*="grd" i]').filter((_, t) => {
        const id = $(t).attr("id") || "";
        return /[Rr]ate/.test(id) && $(t).find("tr").length > 2;
    }).first();
    if (fallback.length) return fallback;
    return null;
}

function readVibhag($) {
    const body = $("body").text() || "";
    const patterns = [
        /Vibhag\s*Number\s*[:：]?\s*(\d+)/i,
        /विभाग\s*क्रमांक\s*[:：]?\s*(\d+)/i,
        /विभाग\s*नं[.]?\s*[:：]?\s*(\d+)/i,
    ];
    for (const p of patterns) {
        const m = body.match(p);
        if (m) return parseInt(m[1], 10);
    }
    return 1;
}

function buildColumnMap(headers) {
    const colMap = {
        zoneNo: -1, subzone: -1, openLand: -1, residential: -1,
        office: -1, shop: -1, industrial: -1, unit: -1, rate: -1,
    };
    headers.forEach((header, i) => {
        const h = (header || "").toLowerCase();
        for (const [key, keywords] of Object.entries(COLUMN_MAP_KEYWORDS)) {
            if (colMap[key] < 0 && keywords.some((k) => h.includes(k.toLowerCase()))) {
                colMap[key] = i;
                break;
            }
        }
    });
    return colMap;
}

function isMultiColFormat(colMap) {
    // True when we detect any rate column by header — covers both urban (खुली जमीन etc.)
    // and rural ('दर') formats
    return colMap.openLand >= 0 || colMap.residential >= 0 ||
           colMap.office >= 0 || colMap.shop >= 0 || colMap.industrial >= 0 ||
           colMap.rate >= 0;
}

// Returns {headers, rows, surveyHrefs} where surveyHrefs[i] is the __doPostBack href
// from the first-column SurveyNo link in rows[i] (or null).
function readTableFull($, table) {
    const headers = [];
    const rows = [];
    const surveyHrefs = [];

    // Prefer <th> headers
    const firstTr = table.find("tr").first();
    firstTr.find("th").each((_, th) => headers.push(normalize($(th).text())));

    // Fallback: detect header from first <td> row if it contains known keywords
    if (!headers.length) {
        const firstTds = firstTr.find("td");
        let looksLike = false;
        firstTds.each((_, td) => {
            const t = $(td).text().toLowerCase();
            if (t.includes("उपविभाग") || t.includes("open land") || t.includes("assessment")) {
                looksLike = true;
            }
        });
        if (looksLike) {
            firstTds.each((_, td) => headers.push(normalize($(td).text())));
        }
    }

    table.find("tr").each((_, tr) => {
        if ($(tr).find("th").length) return;
        const tds = $(tr).find("td");
        if (!tds.length) return;
        if (tds.length === 1 && tds.first().find("table").length) return;

        const cells = [];
        let href = null;
        tds.each((idx, td) => {
            cells.push(normalize($(td).text()));
            if (idx === 0) {
                const a = $(td).find("a").first();
                if (a.length) href = a.attr("href") || null;
            }
        });
        rows.push(cells);
        surveyHrefs.push(href);
    });

    return { headers, rows, surveyHrefs };
}

function parseMultiColEntry(cells, colMap, vibhagNo) {
    if (isPagerRow(cells) || isHeaderRow(cells)) return null;

    // Sub-zone: prefer detected column, else fallback to column 1 (after "Select")
    const szIdx = colMap.subzone >= 0 ? colMap.subzone : (colMap.zoneNo >= 0 ? colMap.zoneNo + 1 : 1);
    const subzone = szIdx < cells.length ? cells[szIdx] : "";
    if (!subzone) return null;

    const entry = { vibhagNo, subzone };

    // Rural zone number (विभाग नं.), e.g. "6/6.1"
    const znIdx = colMap.zoneNo;
    if (znIdx >= 0 && znIdx < cells.length && cells[znIdx]) {
        entry.zoneNo = cells[znIdx];
    }

    // Urban: separate rate columns per property type
    const rateFields = [
        ["openLand", colMap.openLand],
        ["residential", colMap.residential],
        ["office", colMap.office],
        ["shop", colMap.shop],
        ["industrial", colMap.industrial],
    ];

    let hasRate = false;
    for (const [field, idx] of rateFields) {
        if (idx >= 0 && idx < cells.length) {
            const val = parseRate(cells[idx]);
            entry[field] = val;
            if (val > 0) hasRate = true;
        }
    }

    // Rural: single generic 'दर' rate column → maps to openLand
    if (!hasRate && colMap.rate >= 0 && colMap.rate < cells.length) {
        const val = parseRate(cells[colMap.rate]);
        entry.openLand = val;
        if (val > 0) hasRate = true;
    }

    const uIdx = colMap.unit;
    if (uIdx >= 0 && uIdx < cells.length && cells[uIdx]) {
        entry.unit = cells[uIdx];
    }

    return hasRate ? entry : null;
}

function legacyRowToEntry(row) {
    if (!row) return null;
    const label = row.assessmentRange
        ? `${row.assessmentType} — ${row.assessmentRange}`
        : row.assessmentType;
    const entry = { vibhagNo: row.vibhagNo, subzone: label };
    if (row.rate > 0) entry.openLand = row.rate;
    if (row.unit) entry.unit = row.unit;
    return entry;
}

// Legacy row reader (kept as fallback for old-format tables)
function readTableRows($, table) {
    const { rows } = readTableFull($, table);
    return rows;
}

async function extractAllRows(client, $) {
    const table = findRateTable($);
    if (!table) {
        const pageTitle = $("title").text().trim();
        const bodyPreview = $("body").text().replace(/\s+/g, " ").trim().slice(0, 400);
        console.error("[scraper] Rate table not found. Title:", pageTitle);
        console.error("[scraper] All table IDs on page:");
        $("table").each((_, el) => {
            const id = $(el).attr("id") || "(no id)";
            const cls = $(el).attr("class") || "";
            const rows = $(el).find("tr").length;
            console.error(`  id="${id}" class="${cls}" rows=${rows}`);
        });
        console.error("[scraper] Body preview:", bodyPreview);
        throw new ScraperError("Rate table not found on eASR portal.", 404);
    }

    const pageVibhag = readVibhag($);

    // Detect table format (multi-column vs legacy 2-column) from first page headers
    const { headers: firstHeaders } = readTableFull($, table);
    const colMap = buildColumnMap(firstHeaders);
    const multiCol = isMultiColFormat(colMap);

    const entries = [];
    const visited = new Set([1]);
    let current$ = $;
    const maxPages = 20;

    while (visited.size < maxPages) {
        const currentTable = findRateTable(current$);
        if (!currentTable) break;

        const { rows, surveyHrefs } = readTableFull(current$, currentTable);

        for (let i = 0; i < rows.length; i++) {
            const cells = rows[i];
            if (isPagerRow(cells)) continue;

            let entry;
            if (multiCol) {
                entry = parseMultiColEntry(cells, colMap, pageVibhag);
            } else {
                entry = legacyRowToEntry(parseDataRow(cells, pageVibhag));
            }

            if (entry) {
                // Attach survey postback target if the row has a SurveyNo link
                const href = surveyHrefs[i];
                if (href) {
                    const m = href.match(/__doPostBack\('([^']+)','([^']*)'\)/);
                    if (m) {
                        entry.hasSurvey = true;
                        entry._surveyTarget = m[1];
                        entry._surveyArg = m[2] || "";
                    }
                }
                entries.push(entry);
            }
        }

        // Pagination: follow numbered page links
        let nextPage = null;
        currentTable.find("a").each((_, a) => {
            if (nextPage) return;
            const text = normalize(current$(a).text());
            if (/^\d+$/.test(text)) {
                const num = parseInt(text, 10);
                if (!visited.has(num)) nextPage = num;
            }
        });

        if (!nextPage) break;
        visited.add(nextPage);

        const link = currentTable
            .find("a")
            .filter((_, a) => normalize(current$(a).text()) === String(nextPage))
            .first();
        const href = link.attr("href") || "";
        const eventTargetMatch = href.match(/__doPostBack\('([^']+)'/);
        if (!eventTargetMatch) break;

        const fields = collectHiddenFields(current$);
        fields.__EVENTTARGET = eventTargetMatch[1];
        fields.__EVENTARGUMENT = String(nextPage);

        const html = await fetchHtml(client, EASR_URL, fields);
        current$ = cheerio.load(html);
    }

    return entries;
}

// Strip internal scraper state before sending to client / caching
function stripEntryInternals(entry) {
    const { _surveyTarget, _surveyArg, ...rest } = entry;
    return rest;
}

async function scrapeTalukas() {
    const cached = cache.get("talukas", CACHE_TTL_TALUKAS);
    if (cached) return cached;

    const staticData = staticLocations.talukasResponse();
    if (staticData) {
        cache.set("talukas", staticData);
        return staticData;
    }

    try {
        const client = createClient();
        const $ = await openSession(client);
        const { options } = readSelectOptions($, "ddlTaluka", "taluka");
        const talukas = options.map((o) => o.text);
        if (!talukas.length) throw new ScraperError("No talukas found on eASR portal.", 404);
        const result = { district: staticLocations.DISTRICT_NAME, talukas, source: "live" };
        cache.set("talukas", result);
        return result;
    } catch (err) {
        const fallback = staticLocations.talukasResponse();
        if (fallback) return fallback;
        throw err;
    }
}

async function scrapeVillages(taluka) {
    const clean = staticLocations.normalizeName(taluka);
    const cacheKey = `villages:${clean}`;
    const cached = cache.get(cacheKey, CACHE_TTL_VILLAGES);
    if (cached) return cached;

    const staticData = staticLocations.villagesResponse(clean);
    if (staticData) {
        cache.set(cacheKey, staticData);
        return staticData;
    }

    try {
        const client = createClient();
        let $ = await openSession(client);
        $ = await postSelectChange(client, $, "ddlTaluka", clean, "taluka");
        const { options } = readSelectOptions($, "ddlVillage", "village");
        const villages = options.map((o) => o.text);
        if (!villages.length) {
            throw new ScraperError(`No villages found for taluka '${clean}'.`, 404);
        }
        const result = { district: staticLocations.DISTRICT_NAME, taluka: clean, villages, source: "live" };
        cache.set(cacheKey, result);
        return result;
    } catch (err) {
        const fallback = staticLocations.villagesResponse(clean);
        if (fallback) return fallback;
        if (err.code === "ECONNABORTED" || /timeout/i.test(err.message || "")) {
            throw new ScraperError(
                "The government eASR portal is slow right now. Try again in a minute.",
                504
            );
        }
        throw err;
    }
}

function isRetryableScrapeError(err) {
    if (err instanceof ScraperError) {
        return err.statusCode >= 500 || err.statusCode === 504;
    }
    return err.code === "ECONNABORTED" || /timeout|ECONNRESET|ENOTFOUND|ETIMEDOUT/i.test(err.message || "");
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function scrapeRatesViaPython(taluka, village) {
    return new Promise((resolve, reject) => {
        const proc = spawn("python3", [PYTHON_SCRIPT, taluka, village], {
            timeout: RATES_ATTEMPT_TIMEOUT_MS,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        proc.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        proc.on("error", (err) => reject(err));
        proc.on("close", (code) => {
            if (code !== 0) {
                const message = stderr.trim() || stdout.trim() || "Python scrape failed.";
                return reject(new ScraperError(message, 502));
            }
            try {
                resolve(JSON.parse(stdout));
            } catch (err) {
                reject(new ScraperError(`Invalid Python scrape output: ${err.message}`, 502));
            }
        });
    });
}

async function scrapeRatesOnce(taluka, village) {
    const cleanTaluka = staticLocations.normalizeName(taluka);
    const cleanVillage = staticLocations.normalizeName(village);
    const client = createClient(RATES_ATTEMPT_TIMEOUT_MS);
    let $ = await openSession(client);
    $ = await postSelectChange(client, $, "ddlTaluka", cleanTaluka, "taluka");
    $ = await postSelectChange(client, $, "ddlVillage", cleanVillage, "village");

    // First try: if the rate table is already on the page, extract directly
    // (most villages show rates immediately after selection)
    const directTable = findRateTable($);
    if (directTable) {
        const rawEntries = await extractAllRows(client, $);
        if (rawEntries.length) {
            return {
                district: staticLocations.DISTRICT_NAME,
                taluka: cleanTaluka,
                village: cleanVillage,
                entries: rawEntries.map(stripEntryInternals),
                source: "live",
            };
        }
        throw new ScraperError("No rate entries found for the selected taluka and village.", 404);
    }

    // Second try: check for additional dropdowns (year, survey number, etc.)
    // Some villages require selecting a year or survey number first
    const extraDropdown = findSurveyDropdown($);
    if (extraDropdown) {
        const extraOptions = readSurveyOptions($, extraDropdown);
        if (extraOptions.length) {
            const allKeys = [];
            const dataByKey = {};

            for (let i = 0; i < Math.min(extraOptions.length, MAX_SURVEY_NUMBERS); i++) {
                const opt = extraOptions[i];
                try {
                    const next$ = await postSurveyChange(client, $, extraDropdown, opt.value);
                    const rawEntries = await extractAllRows(client, next$);
                    if (rawEntries.length) {
                        const key = opt.text;
                        allKeys.push(key);
                        dataByKey[key] = rawEntries.map(stripEntryInternals);
                    }
                } catch (_) {
                    // skip options that don't produce a rate table
                }
            }

            if (allKeys.length) {
                const firstKey = allKeys[0];
                return {
                    district: staticLocations.DISTRICT_NAME,
                    taluka: cleanTaluka,
                    village: cleanVillage,
                    hasSurveyNumbers: true,
                    surveyNumbers: allKeys,
                    surveyData: dataByKey,
                    entries: dataByKey[firstKey] || [],
                    selectedSurvey: firstKey,
                    source: "live",
                };
            }
        }
    }

    throw new ScraperError("Rate table not found on eASR portal.", 404);
}

async function scrapeRates(taluka, village) {
    const cleanTaluka = staticLocations.normalizeName(taluka);
    const cleanVillage = staticLocations.normalizeName(village);
    const cacheKey = `rates:${cleanTaluka}:${cleanVillage}`;
    const cached = cache.get(cacheKey, CACHE_TTL_RATES);
    if (cached) return cached;

    let lastErr = null;

    for (let attempt = 1; attempt <= RATES_SERVER_ATTEMPTS; attempt++) {
        try {
            const result = await scrapeRatesOnce(cleanTaluka, cleanVillage);
            cache.set(cacheKey, result);
            return result;
        } catch (err) {
            lastErr = err;
            if (err instanceof ScraperError && err.statusCode === 404) throw err;
            if (attempt < RATES_SERVER_ATTEMPTS && isRetryableScrapeError(err)) {
                await delay(1000);
            }
        }
    }

    try {
        const result = await scrapeRatesViaPython(cleanTaluka, cleanVillage);
        cache.set(cacheKey, result);
        return result;
    } catch (pyErr) {
        if (pyErr.code !== "ENOENT") {
            lastErr = pyErr;
        }
    }

    if (lastErr instanceof ScraperError) throw lastErr;
    if (isRetryableScrapeError(lastErr)) {
        throw new ScraperError(
            "The government eASR portal is slow right now. Retrying…",
            504
        );
    }
    throw lastErr || new ScraperError("Could not fetch rates from the government portal.", 502);
}

// Fetch survey/parcel numbers for a specific row (by index) in a village's rate table.
// The eASR portal shows these when you click the "SurveyNo" link in the Select column.
// surveyKey: optional location/survey-type name (e.g. "जिरायत जमिनी") needed for villages
// that require a location dropdown selection before showing the rate table.
async function scrapeSubzoneSurveys(taluka, village, rowIndex, surveyKey) {
    const cleanTaluka = staticLocations.normalizeName(taluka);
    const cleanVillage = staticLocations.normalizeName(village);
    const cleanKey = surveyKey ? staticLocations.normalizeName(surveyKey) : "";
    const cacheKey = `surveys:${cleanTaluka}:${cleanVillage}:${cleanKey}:${rowIndex}`;

    const cached = cache.get(cacheKey, CACHE_TTL_RATES);
    if (cached) return cached;

    const client = createClient(RATES_ATTEMPT_TIMEOUT_MS);
    let page$ = await openSession(client);
    page$ = await postSelectChange(client, page$, "ddlTaluka", cleanTaluka, "taluka");
    page$ = await postSelectChange(client, page$, "ddlVillage", cleanVillage, "village");

    // Some villages (e.g. rural/Pokhari) need a location type selected before showing the rate table
    const directTable = findRateTable(page$);
    if (!directTable) {
        const extraDropdown = findSurveyDropdown(page$);
        if (extraDropdown) {
            const extraOptions = readSurveyOptions(page$, extraDropdown);
            let targetOpt = null;
            if (cleanKey) {
                // Match the requested survey/location key
                targetOpt = extraOptions.find((o) =>
                    normalize(o.text) === cleanKey ||
                    normalize(o.text).includes(cleanKey) ||
                    cleanKey.includes(normalize(o.text))
                );
            }
            // Fallback: use first option
            if (!targetOpt && extraOptions.length) targetOpt = extraOptions[0];
            if (targetOpt) {
                page$ = await postSurveyChange(client, page$, extraDropdown, targetOpt.value);
            }
        }
    }

    const table = findRateTable(page$);
    if (!table) throw new ScraperError("Rate table not found for survey lookup.", 404);

    // Find the rowIndex-th row that has a SurveyNo link in its first column
    let surveyLink = null;
    let count = 0;
    table.find("tr").each((_, tr) => {
        if (surveyLink) return;
        if (page$(tr).find("th").length) return;
        const tds = page$(tr).find("td");
        if (!tds.length) return;
        const a = tds.first().find("a").first();
        if (a.length) {
            if (count === rowIndex) surveyLink = a;
            count++;
        }
    });

    if (!surveyLink) {
        throw new ScraperError(`No SurveyNo link at row ${rowIndex}.`, 404);
    }

    const href = surveyLink.attr("href") || "";
    const m = href.match(/__doPostBack\('([^']+)','([^']*)'\)/);
    if (!m) throw new ScraperError("Cannot parse SurveyNo postback link.", 500);

    const fields = collectHiddenFields(page$);
    fields.__EVENTTARGET = m[1];
    fields.__EVENTARGUMENT = m[2] || "";

    const html = await fetchHtml(client, EASR_URL, fields);
    await delay(POSTBACK_DELAY_MS);
    const next$ = cheerio.load(html);

    // The portal puts survey numbers in a textarea after the SurveyNo click
    let surveyText = "";
    next$("textarea").each((_, el) => {
        const val = next$(el).val() || next$(el).text() || "";
        if (val.trim() && /\d/.test(val)) {
            surveyText = val.trim();
            return false;
        }
    });
    if (!surveyText) {
        next$('input[type="text"]').each((_, el) => {
            const val = next$(el).val() || "";
            if (val.trim() && /\d\//.test(val)) {
                surveyText = val.trim();
                return false;
            }
        });
    }
    // Fallback: search any element with survey-like id/name
    if (!surveyText) {
        next$("[id*='Survey'], [id*='survey'], [name*='Survey'], [name*='survey']").each((_, el) => {
            const val = next$(el).val() || next$(el).text() || "";
            if (val.trim() && /\d/.test(val)) {
                surveyText = val.trim();
                return false;
            }
        });
    }

    const result = {
        taluka: cleanTaluka,
        village: cleanVillage,
        rowIndex,
        surveys: surveyText || null,
    };

    cache.set(cacheKey, result);
    return result;
}

module.exports = {
    ScraperError,
    scrapeTalukas,
    scrapeVillages,
    scrapeRates,
    scrapeSubzoneSurveys,
};
