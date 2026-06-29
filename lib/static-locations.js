const fs = require("fs");
const path = require("path");

const LOCATIONS_FILE = path.join(__dirname, "..", "Website-User", "data", "asr-locations.json");
const DISTRICT_NAME = "Chhatrapati Sambhajinagar";

let cached = null;

function load() {
    if (cached) return cached;
    try {
        cached = JSON.parse(fs.readFileSync(LOCATIONS_FILE, "utf8"));
    } catch {
        cached = {};
    }
    return cached;
}

function normalizeName(value) {
    return String(value || "")
        .trim()
        .normalize("NFC")
        .replace(/\s+/g, " ");
}

/** Normalize names for fuzzy dropdown matching (portal vs static list spacing differs). */
function normalizeMatchKey(value) {
    return normalizeName(value)
        .replace(/[:\u0964]/g, "")
        .replace(/\s*\(\s*/g, "(")
        .replace(/\s*\)\s*/g, ")")
        .replace(/\s*-\s*/g, "-")
        .replace(/\s+/g, " ")
        .trim();
}

function talukaMatches(requested, candidate) {
    const a = normalizeName(requested);
    const b = normalizeName(candidate);
    if (!a || !b) return false;
    if (a === b) return true;
    return a.includes(b) || b.includes(a);
}

function primaryTalukaName(data) {
    const primary = data.talukas?.[0];
    if (!primary) return null;
    return typeof primary === "string" ? primary : primary.name || primary.nameEn || null;
}

function hasStaticVillagesFor(taluka, data = load()) {
    const villages = data.villages || [];
    const primaryName = primaryTalukaName(data);
    if (!villages.length || !primaryName) return false;
    return talukaMatches(taluka, primaryName);
}

function talukasResponse() {
    const data = load();
    const names = (data.talukas || [])
        .map((item) => (typeof item === "string" ? item : item.name || item.nameEn))
        .filter(Boolean);
    if (!names.length) return null;
    return { district: DISTRICT_NAME, talukas: names, source: "static" };
}

function villagesResponse(taluka) {
    const data = load();
    const villages = data.villages || [];
    const clean = normalizeName(taluka);
    if (!villages.length || !clean || !hasStaticVillagesFor(clean, data)) return null;

    return {
        district: DISTRICT_NAME,
        taluka: clean,
        villages,
        source: "static",
    };
}

module.exports = {
    talukasResponse,
    villagesResponse,
    hasStaticVillagesFor,
    talukaMatches,
    normalizeName,
    normalizeMatchKey,
    DISTRICT_NAME,
};
