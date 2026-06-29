const path = require("path");
const express = require("express");
const cors = require("cors");
const { scrapeTalukas, scrapeVillages, scrapeRates, scrapeSubzoneSurveys, ScraperError } = require("./lib/easr-scraper");

const app = express();
const PORT = Number(process.env.PORT) || 8000;
const WEB_DIR = path.join(__dirname, "Website-User");

app.use(cors());

// Explicit route for static taluka/village data (belt-and-suspenders with express.static)
const locationsPath = path.join(WEB_DIR, "data", "asr-locations.json");
app.get("/data/asr-locations.json", (_req, res) => {
    res.sendFile(locationsPath);
});

app.get("/health", (_req, res) => {
    res.json({ status: "ok", runtime: "node" });
});

app.get("/get-talukas", async (_req, res) => {
    try {
        const data = await scrapeTalukas();
        res.json(data);
    } catch (err) {
        sendError(res, err, "Could not load talukas.");
    }
});

app.get("/get-villages", async (req, res) => {
    const taluka = String(req.query.taluka || "").trim();
    if (!taluka) {
        return res.status(400).json({ detail: "taluka query parameter is required." });
    }
    try {
        const data = await scrapeVillages(taluka);
        res.json(data);
    } catch (err) {
        sendError(res, err, "Could not load villages.");
    }
});

app.get("/get-surveys", async (req, res) => {
    const taluka = String(req.query.taluka || "").trim();
    const village = String(req.query.village || "").trim();
    const row = parseInt(req.query.row, 10);
    const page = parseInt(req.query.page, 10) || 1;
    const survey = String(req.query.survey || "").trim(); // optional location/survey-type key
    if (!taluka || !village || isNaN(row) || row < 0) {
        return res.status(400).json({ detail: "taluka, village, and row (>=0) are required." });
    }
    try {
        const data = await scrapeSubzoneSurveys(taluka, village, row, survey || undefined, page);
        res.json(data);
    } catch (err) {
        sendError(res, err, "Could not fetch survey numbers.");
    }
});

app.get("/get-rates", async (req, res) => {
    const taluka = String(req.query.taluka || "").trim();
    const village = String(req.query.village || "").trim();
    const page = parseInt(req.query.page, 10) || 1;
    const surveyNo = String(req.query.surveyNo || req.query.survey || "").trim();
    if (!taluka || !village) {
        return res.status(400).json({ detail: "taluka and village are required." });
    }
    try {
        const data = await scrapeRates(taluka, village, page, surveyNo || undefined);
        res.json(data);
    } catch (err) {
        sendError(res, err, "Could not fetch rates.");
    }
});

function sendError(res, err, fallback) {
    if (err instanceof ScraperError) {
        return res.status(err.statusCode).json({ detail: err.message });
    }
    console.error(err);
    res.status(500).json({ detail: err.message || fallback });
}

app.use(express.static(WEB_DIR, {
    index: "index.html",
    setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
    },
}));

app.listen(PORT, "0.0.0.0", () => {
    console.log(`MahaCivil running at http://0.0.0.0:${PORT}`);
});
