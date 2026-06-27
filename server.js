const path = require("path");
const express = require("express");
const cors = require("cors");
const { scrapeTalukas, scrapeVillages, scrapeRates, ScraperError } = require("./lib/easr-scraper");

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

app.get("/get-rates", async (req, res) => {
    const taluka = String(req.query.taluka || "").trim();
    const village = String(req.query.village || "").trim();
    if (!taluka || !village) {
        return res.status(400).json({ detail: "taluka and village are required." });
    }
    try {
        const data = await scrapeRates(taluka, village);
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

app.use(express.static(WEB_DIR, { index: "index.html" }));

app.listen(PORT, "0.0.0.0", () => {
    console.log(`MahaCivil running at http://0.0.0.0:${PORT}`);
});
