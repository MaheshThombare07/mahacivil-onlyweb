/**
 * Building Permission Calculator
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

    function calculateBuildingPermission() {
        if (!document.getElementById("bp-area1")) return;

        let grandTotal = 0;

        const bdc = getVal("bp-area1") * getVal("bp-asr1") * 0.02 * getVal("bp-factor1");
        setVal("bp-total1", bdc);
        grandTotal += bdc;

        const premPct = parseFloat(document.getElementById("bp-pct2").value) || 0;
        const prem = getVal("bp-area2") * getVal("bp-asr2") * premPct * getVal("bp-factor2");
        setVal("bp-total2", prem);
        grandTotal += prem;

        const anc = getVal("bp-area3") * getVal("bp-asr3") * 0.1 * getVal("bp-factor3");
        setVal("bp-total3", anc);
        grandTotal += anc;

        const sec = getVal("bp-area4") * 20 * 1 * getVal("bp-factor4");
        setVal("bp-total4", sec);
        grandTotal += sec;

        const labG = getVal("bp-area5") * 22869 * 0.0099 * getVal("bp-factor5");
        setVal("bp-total5", labG);
        grandTotal += labG;

        const labC = getVal("bp-area6") * 22869 * 0.0001 * getVal("bp-factor6");
        setVal("bp-total6", labC);
        grandTotal += labC;

        const ldc = getVal("bp-area7") * getVal("bp-asr7") * 0.005 * getVal("bp-factor7");
        setVal("bp-total7", ldc);
        grandTotal += ldc;

        const idc = getVal("bp-area8") * 120 * 1 * getVal("bp-factor8");
        setVal("bp-total8", idc);
        grandTotal += idc;

        const compPct = parseFloat(document.getElementById("bp-pct9").value) || 0;
        const comp = getVal("bp-area9") * 22869 * compPct * getVal("bp-factor9");
        setVal("bp-total9", comp);
        grandTotal += comp;

        setVal("bp-grandTotal", grandTotal);
    }

    function initBuildingPermission() {
        const root = document.getElementById("building-permission-view");
        if (!root) return;

        root.querySelectorAll("input, select").forEach((el) => {
            el.addEventListener("input", calculateBuildingPermission);
            el.addEventListener("change", calculateBuildingPermission);
        });

        const btn = document.getElementById("bp-recalculate");
        if (btn) btn.addEventListener("click", calculateBuildingPermission);

        calculateBuildingPermission();
    }

    window.initBuildingPermission = initBuildingPermission;
    window.calculateBuildingPermission = calculateBuildingPermission;
})();
