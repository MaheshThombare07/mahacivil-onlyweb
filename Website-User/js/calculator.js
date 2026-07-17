/**
 * Calculation logic — mirrors Android OpenPlotCalculator & BuiltUpCalculator
 */
const CONSTANTS = {
    SQ_FT_TO_SQ_M: 0.092903,
    MAX_BUILT_UP_FSI: 1.76,
    BETTERMENT_RATE_RATIO: 1670 / 2100,
    BETTERMENT_FIXED_RATE: 1836   // Rs/sq.m fixed rate for betterment charges
};

function convertSqFtToSqM(sqFt) {
    return sqFt * CONSTANTS.SQ_FT_TO_SQ_M;
}

function formatArea(v) {
    return Number(v).toFixed(2);
}

function formatRate(v) {
    return Number(v) % 1 === 0 ? String(Math.round(v)) : Number(v).toFixed(2);
}

function formatCurrency(v) {
    return "INR " + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTotal(v) {
    return "INR " + Math.round(v).toLocaleString("en-US");
}

function formatDateTime() {
    return new Date().toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: true
    });
}

// authority: "cmrda" (10%) | "csmc" (50%)
function calculateOpenPlot(plotAreaSqM, asrRate, authority) {
    const auth = authority === "cmrda" ? "cmrda" : "csmc";
    const bettermentRate = CONSTANTS.BETTERMENT_FIXED_RATE;   // 1836 Rs/sq.m fixed
    const bettermentPct  = auth === "cmrda" ? 0.10 : 0.50;
    const bettermentLabel = auth === "cmrda" ? "10%" : "50%";

    const charges = [
        { serial: 1, name: "Scrutiny Fee",            rate: "4",                        pct: "NA",          amount: plotAreaSqM * 4 },
        { serial: 2, name: "Land Dev Charges (eASR)", rate: formatRate(asrRate),        pct: "1.5%",        amount: plotAreaSqM * asrRate * 0.015 },
        { serial: 3, name: "Betterment Charges",      rate: formatRate(bettermentRate), pct: bettermentLabel, amount: plotAreaSqM * bettermentRate * bettermentPct }
    ];
    const total = charges.reduce((s, c) => s + c.amount, 0);
    return { plotAreaSqM, asrRate, authority: auth, charges, total, type: "open-plot" };
}

function calculateBuiltUp(plotAreaSqM, asrRate, res, comm, margins) {
    const maxBuiltUp = plotAreaSqM * CONSTANTS.MAX_BUILT_UP_FSI;
    const toBeRegularizedResidential = Math.min(res, maxBuiltUp);
    const ancillaryArea = Math.max(0, toBeRegularizedResidential - (plotAreaSqM * 1.1));
    const toBeRegularizedCommercial = Math.min(comm, maxBuiltUp);
    const notRegularizedArea = Math.max(0, comm - maxBuiltUp);
    const summary = {
        plotAreaSqM, asrRate,
        builtUpResidential: res,
        builtUpCommercial: comm,
        builtUpInMargins: margins,
        maximumBuiltUpAllowed: maxBuiltUp,
        ancillaryAreaConsumed: ancillaryArea,
        toBeRegularizedResidential,
        toBeRegularizedCommercial,
        notRegularizedArea
    };

    const bettermentRate = asrRate * CONSTANTS.BETTERMENT_RATE_RATIO;
    const scrutinyArea = Math.max(plotAreaSqM, res + comm);
    const ancillaryAmount = ancillaryArea * asrRate * 0.10;

    const charges = [
        { name: "Scrutiny Fee", rate: "4", pct: "NA", amount: scrutinyArea * 4 },
        { name: "Betterment Charges", rate: formatRate(bettermentRate), pct: "0%", amount: 0 },
        { name: "Land Dev Charges (eASR)", rate: formatRate(asrRate), pct: "1.5%", amount: plotAreaSqM * asrRate * 0.015 },
        { name: "City Dev Charges - Res", rate: formatRate(asrRate), pct: "2%", amount: toBeRegularizedResidential * asrRate * 0.02 },
        { name: "City Dev Charges - Comm", rate: formatRate(asrRate), pct: "4%", amount: toBeRegularizedCommercial * asrRate * 0.04 },
        { name: "Ancillary", rate: formatRate(asrRate), pct: "10%", amount: ancillaryAmount },
        { name: "Area as per Tip", rate: "As per Ancillary", pct: "", amount: ancillaryAmount },
        { name: "Marginal Distance Penalty", rate: formatRate(asrRate), pct: "10%", amount: margins * asrRate * 0.10 }
    ];

    const total = charges.reduce((s, c) => s + c.amount, 0);
    return { summary, charges, total, type: "built-up" };
}

function chargeLabel(name, lang) {
    const map = {
        "Scrutiny Fee": "scrutinyFee",
        "Land Dev Charges (eASR)": "landDev",
        "Betterment Charges": "betterment",
        "City Dev Charges - Res": "cityDevRes",
        "City Dev Charges - Comm": "cityDevComm",
        "Ancillary": "ancillary",
        "Area as per Tip": "areaTip",
        "Marginal Distance Penalty": "marginalPenalty"
    };
    return t(map[name] || name, lang);
}

const SECTORS = [
    { id: "01", name: "Sector 01", slug: "sm-sector01" },
    { id: "01a", name: "Sector 01A", slug: "sm-sector01a" },
    { id: "02", name: "Sector 02", slug: "sm-sector2" },
    { id: "03", name: "Sector 03", slug: "sm-sector03" },
    { id: "04", name: "Sector 04", slug: "sm-sector04" },
    { id: "05", name: "Sector 05", slug: "sm-sector05" },
    { id: "06", name: "Sector 06", slug: "sm-sector06" },
    { id: "07", name: "Sector 07", slug: "sm-sector07" },
    { id: "08", name: "Sector 08", slug: "sm-sector08" },
    { id: "09", name: "Sector 09", slug: "sm-sector09" },
    { id: "10", name: "Sector 10", slug: "sm-sector10" }
];

const SECTOR_BASE = "https://shivdeveloper4.users.earthengine.app/view/";

function sectorUrl(slug) {
    return SECTOR_BASE + slug;
}
