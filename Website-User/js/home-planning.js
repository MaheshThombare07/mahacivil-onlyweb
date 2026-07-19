/**
 * Home Planning Calculator
 * Approximate estimate based on UltraTech Cost Calculator structure:
 * quantity = builtUpAreaSqFt × Calculation_input
 * cost = quantity × unitRate (Average_Cat_Y for Chhatrapati Sambhajinagar / Aurangabad)
 * Phase split from UltraTech home-building cost guide percentages.
 */
(function (global) {
    const SQM_TO_SQFT = 10.764;

    // UltraTech Cat Y rates (Aurangabad / Chhatrapati Sambhajinagar) + Calculation_input factors
    const QUALITY = {
        basic: {
            labelEn: "Basic",
            labelMr: "बेसिक",
            resources: [
                { id: "cement", nameEn: "Cement", nameMr: "सिमेंट", unitEn: "Bags", unitMr: "पिशव्या", factor: 0.45, rate: 346 },
                { id: "steel", nameEn: "Steel", nameMr: "लोखंड", unitEn: "KG", unitMr: "किलो", factor: 3.5, rate: 43 },
                { id: "bricks", nameEn: "Bricks", nameMr: "विटा", unitEn: "Pcs", unitMr: "नग", factor: 19, rate: 5 },
                { id: "aggregate", nameEn: "Aggregate", nameMr: "दगड / ऍग्रीगेट", unitEn: "Cft", unitMr: "घौ.फूट", factor: 1.9, rate: 28 },
                { id: "sand", nameEn: "Sand", nameMr: "वाळू", unitEn: "Cft", unitMr: "घौ.फूट", factor: 2, rate: 34 },
                { id: "flooring", nameEn: "Flooring", nameMr: "फ्लोअरिंग", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 1, rate: 71 },
                { id: "windows", nameEn: "Windows", nameMr: "खिडक्या", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 0.17, rate: 169 },
                { id: "doors", nameEn: "Doors", nameMr: "दरवाजे", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 0.18, rate: 236 },
                { id: "electrical", nameEn: "Electrical fittings", nameMr: "इलेक्ट्रिकल फिटिंग्ज", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 0.15, rate: 45 },
                { id: "painting", nameEn: "Painting", nameMr: "रंगकाम", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 6, rate: 18 },
                { id: "sanitary", nameEn: "Sanitary fittings", nameMr: "सॅनिटरी फिटिंग्ज", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 1, rate: 55 },
                { id: "kitchen", nameEn: "Kitchen work", nameMr: "स्वयंपाकघराचे काम", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 0.055, rate: 594 },
                { id: "contractor", nameEn: "Contractor (RCC, brick, plaster)", nameMr: "कंत्राटदार (RCC, वीटकाम, प्लास्टर)", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 1, rate: 200 }
            ]
        },
        medium: {
            labelEn: "Medium",
            labelMr: "मध्यम",
            resources: [
                { id: "cement", nameEn: "Cement", nameMr: "सिमेंट", unitEn: "Bags", unitMr: "पिशव्या", factor: 0.45, rate: 366 },
                { id: "steel", nameEn: "Steel", nameMr: "लोखंड", unitEn: "KG", unitMr: "किलो", factor: 3.5, rate: 45 },
                { id: "bricks", nameEn: "Bricks", nameMr: "विटा", unitEn: "Pcs", unitMr: "नग", factor: 19, rate: 7 },
                { id: "aggregate", nameEn: "Aggregate", nameMr: "दगड / ऍग्रीगेट", unitEn: "Cft", unitMr: "घौ.फूट", factor: 1.9, rate: 31 },
                { id: "sand", nameEn: "Sand", nameMr: "वाळू", unitEn: "Cft", unitMr: "घौ.फूट", factor: 2, rate: 39 },
                { id: "flooring", nameEn: "Flooring", nameMr: "फ्लोअरिंग", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 1, rate: 89 },
                { id: "windows", nameEn: "Windows", nameMr: "खिडक्या", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 0.17, rate: 221 },
                { id: "doors", nameEn: "Doors", nameMr: "दरवाजे", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 0.18, rate: 318 },
                { id: "electrical", nameEn: "Electrical fittings", nameMr: "इलेक्ट्रिकल फिटिंग्ज", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 0.15, rate: 58 },
                { id: "painting", nameEn: "Painting", nameMr: "रंगकाम", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 6, rate: 24 },
                { id: "sanitary", nameEn: "Sanitary fittings", nameMr: "सॅनिटरी फिटिंग्ज", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 1, rate: 62 },
                { id: "kitchen", nameEn: "Kitchen work", nameMr: "स्वयंपाकघराचे काम", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 0.055, rate: 921 },
                { id: "contractor", nameEn: "Contractor (RCC, brick, plaster)", nameMr: "कंत्राटदार (RCC, वीटकाम, प्लास्टर)", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 1, rate: 210 }
            ]
        },
        premium: {
            labelEn: "Premium",
            labelMr: "प्रीमियम",
            resources: [
                { id: "cement", nameEn: "Cement", nameMr: "सिमेंट", unitEn: "Bags", unitMr: "पिशव्या", factor: 0.45, rate: 382 },
                { id: "steel", nameEn: "Steel", nameMr: "लोखंड", unitEn: "KG", unitMr: "किलो", factor: 3.5, rate: 50 },
                { id: "bricks", nameEn: "Bricks", nameMr: "विटा", unitEn: "Pcs", unitMr: "नग", factor: 19, rate: 8 },
                { id: "aggregate", nameEn: "Aggregate", nameMr: "दगड / ऍग्रीगेट", unitEn: "Cft", unitMr: "घौ.फूट", factor: 1.9, rate: 33 },
                { id: "sand", nameEn: "Sand", nameMr: "वाळू", unitEn: "Cft", unitMr: "घौ.फूट", factor: 2, rate: 44 },
                { id: "flooring", nameEn: "Flooring", nameMr: "फ्लोअरिंग", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 1, rate: 127 },
                { id: "windows", nameEn: "Windows", nameMr: "खिडक्या", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 0.17, rate: 263 },
                { id: "doors", nameEn: "Doors", nameMr: "दरवाजे", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 0.18, rate: 415 },
                { id: "electrical", nameEn: "Electrical fittings", nameMr: "इलेक्ट्रिकल फिटिंग्ज", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 0.15, rate: 77 },
                { id: "painting", nameEn: "Painting", nameMr: "रंगकाम", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 6, rate: 30 },
                { id: "sanitary", nameEn: "Sanitary fittings", nameMr: "सॅनिटरी फिटिंग्ज", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 1, rate: 83 },
                { id: "kitchen", nameEn: "Kitchen work", nameMr: "स्वयंपाकघराचे काम", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 0.06, rate: 1346 },
                { id: "contractor", nameEn: "Contractor (RCC, brick, plaster)", nameMr: "कंत्राटदार (RCC, वीटकाम, प्लास्टर)", unitEn: "Sq.ft", unitMr: "चौ.फूट", factor: 1, rate: 235 }
            ]
        }
    };

    const PHASES = [
        { id: "planning", nameEn: "Planning, documents & approvals", nameMr: "नियोजन, कागदपत्रे आणि मंजुरी", pct: 2.5 },
        { id: "excavation", nameEn: "Excavation", nameMr: "खोदाई", pct: 3 },
        { id: "foundation", nameEn: "Foundation & footing", nameMr: "फाउंडेशन आणि फूटिंग", pct: 12 },
        { id: "rcc", nameEn: "RCC framework", nameMr: "RCC चौकट", pct: 10 },
        { id: "slab", nameEn: "Slab & roof", nameMr: "स्लॅब आणि छत", pct: 13 },
        { id: "brickwork", nameEn: "Brickwork & plastering", nameMr: "वीटकाम आणि प्लास्टर", pct: 17 },
        { id: "flooring", nameEn: "Flooring & tiling", nameMr: "फ्लोअरिंग आणि टायलिंग", pct: 10 },
        { id: "electrical", nameEn: "Electrical works", nameMr: "इलेक्ट्रिकल कामे", pct: 8 },
        { id: "plumbing", nameEn: "Plumbing", nameMr: "प्लंबिंग", pct: 5 },
        { id: "doors", nameEn: "Doors & windows", nameMr: "दरवाजे आणि खिडक्या", pct: 8 },
        { id: "interiors", nameEn: "Interiors & painting", nameMr: "इंटिरियर आणि रंगकाम", pct: 6 },
        { id: "furnishing", nameEn: "Furnishing", nameMr: "फर्निशिंग", pct: 5.5 }
    ];

    function toSqFt(area, unit) {
        const n = Number(area) || 0;
        return unit === "sqm" ? n * SQM_TO_SQFT : n;
    }

    function formatInr(n) {
        return "₹ " + Math.round(Number(n) || 0).toLocaleString("en-IN");
    }

    function formatQty(n) {
        const v = Number(n) || 0;
        if (v >= 100) return Math.round(v).toLocaleString("en-IN");
        return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
    }

    function calculateHomePlanning(area, unit, qualityKey) {
        const quality = QUALITY[qualityKey] || QUALITY.medium;
        const areaSqFt = toSqFt(area, unit);
        if (areaSqFt <= 0) {
            return {
                areaSqFt: 0,
                quality: qualityKey,
                resources: [],
                phases: PHASES.map((p) => ({ ...p, amount: 0 })),
                totalCost: 0,
                costPerSqFt: 0,
                costPerSqM: 0
            };
        }

        const resources = quality.resources.map((r) => {
            const qty = areaSqFt * r.factor;
            const amount = qty * r.rate;
            return { ...r, qty, amount };
        });

        const totalCost = resources.reduce((s, r) => s + r.amount, 0);
        const costPerSqFt = totalCost / areaSqFt;
        const costPerSqM = totalCost / (areaSqFt / SQM_TO_SQFT);

        const phases = PHASES.map((p) => ({
            ...p,
            amount: totalCost * (p.pct / 100)
        }));

        return {
            areaSqFt,
            quality: qualityKey,
            resources,
            phases,
            totalCost,
            costPerSqFt,
            costPerSqM
        };
    }

    global.HOME_PLANNING_QUALITY = QUALITY;
    global.HOME_PLANNING_PHASES = PHASES;
    global.calculateHomePlanning = calculateHomePlanning;
    global.formatHomePlanningInr = formatInr;
    global.formatHomePlanningQty = formatQty;
})(window);
