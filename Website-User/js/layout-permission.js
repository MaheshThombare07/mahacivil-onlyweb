/**
 * Layout Permission Calculator
 */
(function () {
    function getVal(id) {
        const el = document.getElementById(id);
        return el ? parseFloat(el.value) || 0 : 0;
    }

    function setVal(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = Number(val).toFixed(2);
    }

    function calculateLayoutPermission() {
        if (!document.getElementById("lp-area-ldc")) return;

        const isCidco = !!document.getElementById("lp-is-cidco")?.checked;
        const isItor = !!document.getElementById("lp-is-itor")?.checked;
        const zoneType = document.getElementById("lp-zone-type")?.value || "yellow";
        const isNaApplicable = zoneType !== "yellow";

        const areaIdc = document.getElementById("lp-area-idc");
        const areaItor = document.getElementById("lp-area-itor");
        const asrItor = document.getElementById("lp-asr-itor");
        const areaNa = document.getElementById("lp-area-na");
        const asrNa = document.getElementById("lp-asr-na");
        const pctNa = document.getElementById("lp-pct-na");

        if (areaIdc) areaIdc.disabled = !isCidco;
        if (areaItor) areaItor.disabled = !isItor;
        if (asrItor) asrItor.disabled = !isItor;
        if (areaNa) areaNa.disabled = !isNaApplicable;
        if (asrNa) asrNa.disabled = !isNaApplicable;
        if (pctNa) pctNa.disabled = !isNaApplicable;

        let grandTotal = 0;

        const factorLdc = parseFloat(document.getElementById("lp-factor-ldc")?.value) || 1;
        const ldc = getVal("lp-area-ldc") * getVal("lp-asr-ldc") * 0.005 * factorLdc;
        setVal("lp-total-ldc", ldc);
        grandTotal += ldc;

        let na = 0;
        if (isNaApplicable) {
            const naPct = parseFloat(document.getElementById("lp-pct-na")?.value) || 0;
            na = getVal("lp-area-na") * getVal("lp-asr-na") * (naPct / 100);
        }
        setVal("lp-total-na", na);
        grandTotal += na;

        let idc = 0;
        if (isCidco) {
            idc = getVal("lp-area-idc") * 120;
        }
        setVal("lp-total-idc", idc);
        grandTotal += idc;

        let itor = 0;
        if (isItor) {
            itor = getVal("lp-area-itor") * getVal("lp-asr-itor") * 0.025;
        }
        setVal("lp-total-itor", itor);
        grandTotal += itor;

        setVal("lp-grand-total", grandTotal);
    }

    function initLayoutPermission() {
        const root = document.getElementById("layout-permission-view");
        if (!root) return;

        root.querySelectorAll("input, select").forEach((el) => {
            el.addEventListener("input", calculateLayoutPermission);
            el.addEventListener("change", calculateLayoutPermission);
        });

        calculateLayoutPermission();
    }

    window.initLayoutPermission = initLayoutPermission;
    window.calculateLayoutPermission = calculateLayoutPermission;
})();
