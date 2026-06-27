const crypto = require("crypto");
const { scrapeRates, ScraperError } = require("./easr-scraper");
const cache = require("./cache");

const jobs = new Map();
const JOB_TTL_MS = 15 * 60 * 1000;
const CACHE_TTL_RATES = 30 * 60 * 1000;
const JOB_MAX_RUNS = 3;
const JOB_RETRY_DELAY_MS = 1500;

function ratesCacheKey(taluka, village) {
    return `rates:${taluka}:${village}`;
}

function scheduleCleanup(id) {
    setTimeout(() => jobs.delete(id), JOB_TTL_MS);
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runJob(id, taluka, village) {
    for (let run = 1; run <= JOB_MAX_RUNS; run++) {
        const job = jobs.get(id);
        if (!job || job.status !== "pending") return;

        job.attempt = run;
        job.lastError = null;

        try {
            const data = await scrapeRates(taluka, village);
            cache.set(ratesCacheKey(taluka, village), data);
            jobs.set(id, { status: "done", data, at: Date.now() });
            return;
        } catch (err) {
            const current = jobs.get(id);
            if (!current || current.status !== "pending") return;

            current.lastError = err.message || String(err);

            if (err instanceof ScraperError && err.statusCode === 404) {
                jobs.set(id, { status: "error", detail: err.message, at: Date.now() });
                return;
            }

            if (run < JOB_MAX_RUNS) {
                await delay(JOB_RETRY_DELAY_MS);
                continue;
            }

            jobs.set(id, {
                status: "error",
                detail: err.message || "Could not fetch rates from the government portal.",
                at: Date.now(),
            });
        }
    }
}

function startRatesJob(taluka, village) {
    const cleanTaluka = taluka.trim();
    const cleanVillage = village.trim();
    const id = crypto.randomUUID();

    const cached = cache.get(ratesCacheKey(cleanTaluka, cleanVillage), CACHE_TTL_RATES);
    if (cached) {
        jobs.set(id, { status: "done", data: cached, at: Date.now() });
        scheduleCleanup(id);
        return id;
    }

    jobs.set(id, {
        status: "pending",
        taluka: cleanTaluka,
        village: cleanVillage,
        attempt: 0,
        at: Date.now(),
    });

    runJob(id, cleanTaluka, cleanVillage).catch((err) => {
        console.error("rate job failed:", err);
        const current = jobs.get(id);
        if (current && current.status === "pending") {
            jobs.set(id, {
                status: "error",
                detail: err.message || "Could not fetch rates.",
                at: Date.now(),
            });
        }
    });

    scheduleCleanup(id);
    return id;
}

function getJob(id) {
    return jobs.get(id) || null;
}

module.exports = { startRatesJob, getJob };
