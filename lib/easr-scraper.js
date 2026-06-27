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
    let match = options.find((o) => normalize(o.text) === targetNorm);
    if (match) return match;
    match = options.find((o) => {
        const text = normalize(o.text);
        return text.includes(targetNorm) || targetNorm.includes(text);
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

function readTableRows($, table) {
    const rows = [];
    table.find("tr").each((_, tr) => {
        if ($(tr).find("th").length) return;
        const tds = $(tr).find("td");
        if (!tds.length) return;
        if (tds.length === 1 && tds.first().find("table").length) return;
        const cells = [];
        tds.each((__, td) => cells.push(normalize($(td).text())));
        rows.push(cells);
    });
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
    const allRows = [];
    const visited = new Set([1]);
    let current$ = $;
    const maxPages = 20;

    while (visited.size < maxPages) {
        const currentTable = findRateTable(current$);
        if (!currentTable) break;

        const rawRows = readTableRows(current$, currentTable);
        for (const cells of rawRows) {
            if (isPagerRow(cells)) continue;
            const parsed = parseDataRow(cells, pageVibhag);
            if (parsed) allRows.push(parsed);
        }

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

    return allRows;
}

function groupEntries(flatRows) {
    const groups = new Map();
    for (const row of flatRows) {
        const key = row.assessmentType;
        if (!groups.has(key)) {
            groups.set(key, {
                vibhagNo: row.vibhagNo,
                assessmentType: key,
                rates: [],
            });
        }
        if (row.rate === 0) continue;
        groups.get(key).rates.push({
            assessmentRange: row.assessmentRange,
            rate: row.rate,
            unit: row.unit,
        });
    }
    return [...groups.values()].filter((e) => e.rates.length > 0);
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
        const flatRows = await extractAllRows(client, $);
        if (flatRows.length) {
            return {
                district: staticLocations.DISTRICT_NAME,
                taluka: cleanTaluka,
                village: cleanVillage,
                entries: groupEntries(flatRows),
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
                    const flatRows = await extractAllRows(client, next$);
                    if (flatRows.length) {
                        const key = opt.text;
                        allKeys.push(key);
                        dataByKey[key] = groupEntries(flatRows);
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

module.exports = {
    ScraperError,
    scrapeTalukas,
    scrapeVillages,
    scrapeRates,
};
