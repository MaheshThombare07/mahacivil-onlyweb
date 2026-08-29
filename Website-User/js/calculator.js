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

// authority: "cmrda" (CSMRDA) | "csmc"
function calculateOpenPlot(plotAreaSqM, asrRate, authority) {
    const auth = authority === "cmrda" ? "cmrda" : "csmc";
    const bettermentRate = CONSTANTS.BETTERMENT_FIXED_RATE;   // 1836 Rs/sq.m fixed
    // CSMC & CSMRDA open plot: Betterment 50%
    const bettermentPct = 0.50;
    const bettermentLabel = "50%";

    const charges = [
        { serial: 1, name: "Scrutiny Fee",            rate: "4",                        pct: "NA",   amount: plotAreaSqM * 4 },
        { serial: 2, name: "Land Dev Charges (eASR)", rate: formatRate(asrRate),        pct: "1.5%", amount: plotAreaSqM * asrRate * 0.015 },
    ];

    // CSMRDA: extra Land Dev Charges = eASR × 0.50
    if (auth === "cmrda") {
        charges.push({
            serial: 3,
            name: "Land Dev Charges",
            rate: formatRate(asrRate),
            pct: "0.50",
            amount: asrRate * 0.50
        });
    }

    charges.push({
        serial: auth === "cmrda" ? 4 : 3,
        name: "Betterment Charges",
        rate: formatRate(bettermentRate),
        pct: bettermentLabel,
        amount: plotAreaSqM * bettermentRate * bettermentPct
    });

    const total = charges.reduce((s, c) => s + c.amount, 0);
    return { plotAreaSqM, asrRate, authority: auth, charges, total, type: "open-plot" };
}

function calculateBuiltUp(plotAreaSqM, asrRate, res, comm, margins, authority, builtUpMode) {
    const auth = authority === "cmrda" ? "cmrda" : "csmc";
    const mode = (auth === "csmc" && builtUpMode === "mix") ? "mix" : "residential";
    const bettermentRate = CONSTANTS.BETTERMENT_FIXED_RATE;

    if (mode === "mix") {
        // Res + Comm (mix) — commercial priority FSI logic
        const basicAllowed = plotAreaSqM * 1.1;
        const maxResLimit = basicAllowed * 1.6;
        const maxCommLimit = basicAllowed * 1.8;

        const toRegComm = Math.min(comm, maxCommLimit);
        const basicUsedByComm = toRegComm / 1.8;
        const remBasicForRes = Math.max(0, basicAllowed - basicUsedByComm);
        const dynamicResAllowed = remBasicForRes * 1.6;
        const toRegRes = Math.min(res, dynamicResAllowed);

        const totalInputArea = res + comm;
        const totalRegArea = toRegComm + toRegRes;
        const notRegularizedArea = Math.max(0, totalInputArea - totalRegArea);
        const ancillaryArea = totalRegArea > basicAllowed ? totalRegArea - basicAllowed : 0;

        const bettermentMultiplier = plotAreaSqM < 200 ? 0 : 1;
        const bettermentAmount = plotAreaSqM * bettermentRate * bettermentMultiplier;
        const ancillaryAmount = ancillaryArea * asrRate * 0.1;

        const summary = {
            plotAreaSqM,
            asrRate,
            builtUpResidential: res,
            builtUpCommercial: comm,
            builtUpInMargins: margins,
            basicAllowed,
            maxResLimit,
            maxCommLimit,
            maximumBuiltUpAllowed: maxResLimit, // for generic receipt fallback
            ancillaryAreaConsumed: ancillaryArea,
            toBeRegularizedResidential: toRegRes,
            toBeRegularizedCommercial: toRegComm,
            notRegularizedArea
        };

        const charges = [
            { name: "Scrutiny Fee", rate: "4", pct: "NA", amount: Math.max(plotAreaSqM, totalInputArea) * 4 },
            { name: "Betterment Charges", rate: formatRate(bettermentRate), pct: "Condition", amount: bettermentAmount },
            { name: "Land Dev Charges (eASR)", rate: formatRate(asrRate), pct: "1.5%", amount: plotAreaSqM * asrRate * 0.015 },
            { name: "City Dev Charges - Res", rate: formatRate(asrRate), pct: "2%", amount: toRegRes * asrRate * 0.02 },
            { name: "City Dev Charges - Comm", rate: formatRate(asrRate), pct: "4%", amount: toRegComm * asrRate * 0.04 },
            { name: "Ancillary", rate: formatRate(asrRate), pct: "10%", amount: ancillaryAmount },
            { name: "Area as per Tip", rate: "0", pct: "", amount: 0 },
            { name: "Marginal Distance Penalty", rate: "0", pct: "0%", amount: 0 }
        ];

        const total = charges.reduce((s, c) => s + c.amount, 0);
        return { summary, charges, total, type: "built-up", authority: auth, builtUpMode: "mix" };
    }

    // Residential (existing) — also used for CSMRDA Built Up
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

    // CSMC residential: 0%. CSMRDA: 50% of (plot × ₹1836)
    const bettermentPct = auth === "cmrda" ? 0.50 : 0;
    const bettermentLabel = auth === "cmrda" ? "50%" : "0%";
    const bettermentAmount = plotAreaSqM * bettermentRate * bettermentPct;

    const scrutinyArea = Math.max(plotAreaSqM, res + comm);
    const ancillaryAmount = ancillaryArea * asrRate * 0.10;

    // CSMC: Tip = 0, Marginal penalty = 0. CSMRDA: Tip = ancillary, Marginal = 10%.
    const tipAmount = auth === "csmc" ? 0 : ancillaryAmount;
    const tipRate = auth === "csmc" ? "0" : "As per Ancillary";
    const marginPct = auth === "csmc" ? 0 : 0.10;
    const marginLabel = auth === "csmc" ? "0%" : "10%";
    const marginRate = auth === "csmc" ? "0" : formatRate(asrRate);

    const charges = [
        { name: "Scrutiny Fee", rate: "4", pct: "NA", amount: scrutinyArea * 4 },
        { name: "Betterment Charges", rate: formatRate(bettermentRate), pct: bettermentLabel, amount: bettermentAmount },
        { name: "Land Dev Charges (eASR)", rate: formatRate(asrRate), pct: "1.5%", amount: plotAreaSqM * asrRate * 0.015 },
        { name: "City Dev Charges - Res", rate: formatRate(asrRate), pct: "2%", amount: toBeRegularizedResidential * asrRate * 0.02 },
        { name: "City Dev Charges - Comm", rate: formatRate(asrRate), pct: "4%", amount: toBeRegularizedCommercial * asrRate * 0.04 },
        { name: "Ancillary", rate: formatRate(asrRate), pct: "10%", amount: ancillaryAmount },
        { name: "Area as per Tip", rate: tipRate, pct: "", amount: tipAmount },
        { name: "Marginal Distance Penalty", rate: marginRate, pct: marginLabel, amount: margins * asrRate * marginPct }
    ];

    const total = charges.reduce((s, c) => s + c.amount, 0);
    return { summary, charges, total, type: "built-up", authority: auth, builtUpMode: "residential" };
}

function chargeLabel(name, lang) {
    const map = {
        "Scrutiny Fee": "scrutinyFee",
        "Land Dev Charges (eASR)": "landDev",
        "Land Dev Charges": "landDev50",
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
    {
        id: "01",
        name: "Sector 01",
        nameMr: "सेक्टर ०१",
        slug: "sm-sector01",
        areasEn: ["Pahadsingpura", "Begampura", "Jaysingpura", "Padegaon", "Bavasingpura", "Mitmita", "Bhavsingpura"],
        areasMr: ["पहाडसिंगपुरा", "बेगमपुरा", "जयसिंगपुरा", "पडेगांव", "बावसिंगपुरा", "मिटमिटा", "भावसिंगपुरा"]
    },
    {
        id: "01a",
        name: "Sector 01A",
        nameMr: "सेक्टर ०१अ",
        slug: "sm-sector01a",
        areasEn: ["Mill Corner", "Noor Colony", "Bibi Ka Maqbara", "Ghati", "Asef Bag"],
        areasMr: ["मिल कॉर्नर", "नूर कॉलनी", "बिबीका मकबरा", "घाटी", "आसेफ बाग"]
    },
    {
        id: "02",
        name: "Sector 02",
        nameMr: "सेक्टर ०२",
        slug: "sm-sector2",
        areasEn: ["Majipura", "Mahaveer Chowk", "Kranti Chowk", "Paithan Gate", "Sanjay Nagar (Slum)", "Siddharth Garden", "Baba Petrol Pump"],
        areasMr: ["माजीपुरा", "महावीर चौक", "क्रांती चौक", "पैठण गेट", "संजय नगर (झोपडपट्टी)", "सिद्धार्थ गार्डन", "बाबा पेट्रोल पंप"]
    },
    {
        id: "03",
        name: "Sector 03",
        nameMr: "सेक्टर ०३",
        slug: "sm-sector03",
        areasEn: ["Collector Office", "Jasvantpura", "Kiradpura", "Indira Nagar (Slum)", "Harsh Nagar (Slum)"],
        areasMr: ["जिल्हाधिकारी कार्यालय", "जसवंतपुरा", "किराडपुरा", "इंदिरा नगर (झोपडपट्टी)", "हर्ष नगर (झोपडपट्टी)"]
    },
    {
        id: "04",
        name: "Sector 04",
        nameMr: "सेक्टर ०४",
        slug: "sm-sector04",
        areasEn: ["Harsul", "Jadhavwadi (Agri. Market Committee)", "Himayat Nagar"],
        areasMr: ["हर्सुल", "जाधववाडी (कृषी बाजार समिती)", "हिमायतनगर"]
    },
    {
        id: "05",
        name: "Sector 05",
        nameMr: "सेक्टर ०५",
        slug: "sm-sector05",
        areasEn: ["Chikalthana", "Brijwadi", "Nagegaon (Slum)", "Namakwadi", "CIDCO"],
        areasMr: ["चिकलठाणा", "ब्रिजवाडी", "नगेगांव (झोपडपट्टी)", "नमकवाडी", "सिडको"]
    },
    {
        id: "06",
        name: "Sector 06",
        nameMr: "सेक्टर ०६",
        slug: "sm-sector06",
        areasEn: ["Mukundwadi", "Satara (some part)", "Deolai (some part)", "Murtajapur", "Airport", "Chikalthana (part)"],
        areasMr: ["मुकुंदवाडी", "सातारा (काही भाग)", "देवळाई (काही भाग)", "मुर्तजापूर", "विमानतळ", "चिकलठाणा (भाग)"]
    },
    {
        id: "07",
        name: "Sector 07",
        nameMr: "सेक्टर ०७",
        slug: "sm-sector07",
        areasEn: ["Shanoorwadi", "Baghsher Jung", "Garkheda", "Satara (parts)", "Amar Madhubanaka"],
        areasMr: ["शहानुरवाडी", "बागशेर जंग", "गारखेडा", "सातारा (भाग)", "अमर मधुबनका"]
    },
    {
        id: "08",
        name: "Sector 08",
        nameMr: "सेक्टर ०८",
        slug: "sm-sector08",
        areasEn: ["Satara", "Devlai", "Mustafabad", "Shanoorwadi"],
        areasMr: ["सातारा", "देवळाई", "मुस्तफाबाद", "शहानुरवाडी"]
    },
    {
        id: "09",
        name: "Sector 09",
        nameMr: "सेक्टर ०९",
        slug: "sm-sector09",
        areasEn: ["J-Tower", "Satara (part)", "Shreya Nagar", "Usmanpura", "Kranti Chowk"],
        areasMr: ["जे-टॉवर", "सातारा (भाग)", "श्रेया नगर", "उस्मानपुरा", "क्रांती चौक"]
    },
    {
        id: "10",
        name: "Sector 10",
        nameMr: "सेक्टर १०",
        slug: "sm-sector10",
        areasEn: ["Itkheda", "Kanchanwadi", "Nakshatrawadi", "Padampura"],
        areasMr: ["ईटखेडा", "कांचनवाडी", "नक्षत्रवाडी", "पदंपुरा"]
    }
];

const SECTOR_BASE = "https://shivdeveloper4.users.earthengine.app/view/";

function sectorUrl(slug) {
    return SECTOR_BASE + slug;
}

/** Area-wise maps from https://csmrda.in/maps */
const CSMRDA_MAPS = [
    { nameEnglish: "Chhatrapati Sambhajinagar", nameMarathi: "छत्रपती संभाजीनगर", mapUrl: "https://csmrda.in/starterPage/Daultabad.png" },
    { nameEnglish: "Bidkin", nameMarathi: "बिडकीन", mapUrl: "https://csmrda.in/starterPage/bidkin.png" },
    { nameEnglish: "Daulatabad", nameMarathi: "दौलताबाद", mapUrl: "https://csmrda.in/starterPage/Daultabad.png" },
    { nameEnglish: "Mahesmaal", nameMarathi: "महेशमाळ", mapUrl: "https://csmrda.in/starterPage/mahesmaal.png" },
    { nameEnglish: "Navnagar", nameMarathi: "नवीनगर", mapUrl: "https://csmrda.in/starterPage/navangar.jpg" },
    { nameEnglish: "Shulibhanjan", nameMarathi: "शुलिभंजन", mapUrl: "https://csmrda.in/starterPage/shulanjan.png" },
    { nameEnglish: "Verul", nameMarathi: "वेरुळ", mapUrl: "https://csmrda.in/starterPage/verul.png" },
    { nameEnglish: "Waluj", nameMarathi: "वालुज", mapUrl: "https://csmrda.in/starterPage/waluj_notified.png" },
    { nameEnglish: "Waluj DP Nagar I", nameMarathi: "वालुज डीपी नगर १", mapUrl: "https://csmrda.in/starterPage/Waluj_DP_Nagar%20I.jpg" },
    { nameEnglish: "Waluj DP Nagar II", nameMarathi: "वालुज डीपी नगर २", mapUrl: "https://csmrda.in/starterPage/Waluj_DP_Nagar%20II.jpg" },
    { nameEnglish: "Sector I M (Jatwada, Ohar, Islampurwadi)", nameMarathi: "सेक्टर I M (जटवाडा, ओहळ, इस्लामपूरवाडी)", mapUrl: "https://csmrda.in/starterPage/sector_I%20(1).jpg" },
    { nameEnglish: "Sector II N (Savangi, Tulapur, Ashrafpur, Krishnapur)", nameMarathi: "सेक्टर II N (सावंगी, तुलापुर, अशरफपूर, कृष्णापूर)", mapUrl: "https://csmrda.in/starterPage/sector_II.jpg" },
    { nameEnglish: "Sector III P (Pisadevi, Hirapur, Fattepur)", nameMarathi: "सेक्टर III P (पिसादेवी, हिरापूर, फत्तेपूर)", mapUrl: "https://csmrda.in/starterPage/sector_III.jpg" },
    { nameEnglish: "Sector IV Q (Balapur, Gandheli, Zalta, Sunderwadi)", nameMarathi: "सेक्टर IV Q (बालापूर, गांधेली, झल्टा, सुंदरवाडी)", mapUrl: "https://csmrda.in/starterPage/sector_IV%20(1).jpg" },
    { nameEnglish: "Sector V R (Satara, Devlai)", nameMarathi: "सेक्टर V R (सातारा, देवलाई)", mapUrl: "https://csmrda.in/starterPage/sector_V.jpg" },
    { nameEnglish: "Sector VI S (Georai, Gevrai Tanda)", nameMarathi: "सेक्टर VI S (गेवराई, गेवराई तांडा)", mapUrl: "https://csmrda.in/starterPage/sector_Vi.jpg" }
];

/** UDCPR Table 6-G road-width slabs (min inclusive, max exclusive; last open-ended) */
const FSI_SLABS = [
    { id: "below9",  labelEn: "Below 9 m",        labelMr: "९ मी पेक्षा कमी",     min: 0,  max: 9,  basic: 1.10, prem: 0,    tdr: 0,    maxPotential: 1.10 },
    { id: "9to12",   labelEn: "9 m – <12 m",       labelMr: "९ मी – <१२ मी",       min: 9,  max: 12, basic: 1.10, prem: 0.50, tdr: 0.40, maxPotential: 2.00 },
    { id: "12to15",  labelEn: "12 m – <15 m",      labelMr: "१२ मी – <१५ मी",      min: 12, max: 15, basic: 1.10, prem: 0.50, tdr: 0.65, maxPotential: 2.25 },
    { id: "15to24",  labelEn: "15 m – <24 m",      labelMr: "१५ मी – <२४ मी",      min: 15, max: 24, basic: 1.10, prem: 0.50, tdr: 0.90, maxPotential: 2.50 },
    { id: "24to30",  labelEn: "24 m – <30 m",      labelMr: "२४ मी – <३० मी",      min: 24, max: 30, basic: 1.10, prem: 0.50, tdr: 1.15, maxPotential: 2.75 },
    { id: "30plus",  labelEn: "30 m and above",    labelMr: "३० मी आणि अधिक",     min: 30, max: Infinity, basic: 1.10, prem: 0.50, tdr: 1.40, maxPotential: 3.00 }
];

function findFsiSlab(roadWidth) {
    const road = Number(roadWidth);
    if (roadWidth === "" || roadWidth == null || isNaN(road) || road < 0) return null;
    return FSI_SLABS.find((s) => road >= s.min && road < s.max) || FSI_SLABS[FSI_SLABS.length - 1];
}

function formatFsiArea(v) {
    return Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

function formatFsiFsi(v) {
    return Number(v || 0).toFixed(2);
}

/**
 * FSI & Premium Calculator — UDCPR Table 6-G
 * premOpted: 0..slab.prem, tdrOpted: 0..slab.tdr
 */
function calculateFsi(plotArea, roadWidth, premOpted, tdrOpted) {
    const area = Number(plotArea) || 0;
    const slab = findFsiSlab(roadWidth);
    if (!slab || area <= 0) {
        return {
            slab: null,
            premOpted: 0,
            tdrOpted: 0,
            basicArea: 0,
            premArea: 0,
            tdrArea: 0,
            maxArea: 0,
            totalArea: 0,
            capped: false,
            premiumAllowed: false,
            tdrAllowed: false
        };
    }

    const premMax = slab.prem || 0;
    const tdrMax = slab.tdr || 0;
    const prem = Math.min(Math.max(0, Number(premOpted) || 0), premMax);
    const tdr = Math.min(Math.max(0, Number(tdrOpted) || 0), tdrMax);

    const basicArea = area * slab.basic;
    const premArea = area * prem;
    const tdrArea = area * tdr;
    const maxArea = area * slab.maxPotential;
    let totalArea = basicArea + premArea + tdrArea;
    const capped = totalArea > maxArea;
    if (capped) totalArea = maxArea;

    return {
        slab,
        premOpted: prem,
        tdrOpted: tdr,
        basicArea,
        premArea,
        tdrArea,
        maxArea,
        totalArea,
        capped,
        premiumAllowed: premMax > 0,
        tdrAllowed: tdrMax > 0
    };
}
