/**
 * Building Permission Calculator — CSMRDA & CSMC (AMC)
 */
(function () {
    let authority = "csmrda"; // "csmrda" | "csmc"

    function getVal(id) {
        const el = document.getElementById(id);
        return el ? parseFloat(el.value) || 0 : 0;
    }

    function setVal(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = Number(val).toFixed(2);
    }

    function setInput(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val;
    }

    /* ── CSMRDA (existing) ── */
    function calculateCsmrda() {
        if (!document.getElementById("bp-area1")) return;

        let grandTotal = 0;

        const bdc = getVal("bp-area1") * getVal("bp-asr1") * 0.02 * getVal("bp-factor1");
        setVal("bp-total1", bdc);
        grandTotal += bdc;

        const premPctEl = document.getElementById("bp-pct2");
        const premPct = premPctEl ? parseFloat(premPctEl.value) || 0 : 0;
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

        const compPctEl = document.getElementById("bp-pct9");
        const compPct = compPctEl ? parseFloat(compPctEl.value) || 0 : 0;
        const comp = getVal("bp-area9") * 22869 * compPct * getVal("bp-factor9");
        setVal("bp-total9", comp);
        grandTotal += comp;

        setVal("bp-grandTotal", grandTotal);
    }

    /* ── CSMC / AMC ── */
    function fillMasterAsr() {
        const master = document.getElementById("bp-csmc-master-asr");
        if (!master) return;
        const val = master.value === "" ? "0" : master.value;
        document.querySelectorAll(".bp-csmc-asr").forEach((input) => {
            input.value = val;
        });
        calculateCsmc();
    }

    function toggleOpenSpaceRow() {
        const sel = document.getElementById("bp-csmc-sanctioned");
        const row = document.getElementById("bp-csmc-row-open");
        if (!sel || !row) return;
        const isNonSanctioned = sel.value === "No";
        row.classList.toggle("hidden", !isNonSanctioned);
        calculateCsmc();
    }

    function clearCsmc() {
        setInput("bp-csmc-master-asr", "0");
        setInput("bp-csmc-plot", "0");
        setInput("bp-csmc-builtup", "0");
        setInput("bp-csmc-comm", "0");
        const sel = document.getElementById("bp-csmc-sanctioned");
        if (sel) sel.value = "Yes";
        ["bp-csmc-asr2", "bp-csmc-asr3", "bp-csmc-asr4", "bp-csmc-asr5", "bp-csmc-asr9",
            "bp-csmc-area4", "bp-csmc-area5", "bp-csmc-area9"].forEach((id) => setInput(id, "0"));
        toggleOpenSpaceRow();
    }

    function calculateCsmc() {
        if (!document.getElementById("bp-csmc-builtup")) return;

        const plotArea = getVal("bp-csmc-plot");
        const builtupArea = getVal("bp-csmc-builtup");
        const commArea = getVal("bp-csmc-comm");
        const sel = document.getElementById("bp-csmc-sanctioned");
        const isNonSanctioned = sel && sel.value === "No";

        let grandTotal = 0;

        // 1. Security Deposit (slab)
        let total1 = 0;
        if (builtupArea > 0 && builtupArea <= 300) total1 = 10000;
        else if (builtupArea > 300) total1 = 25000;
        setVal("bp-csmc-total1", total1);
        grandTotal += total1;

        // 2. City Development Charges 2%
        const total2 = 0.02 * getVal("bp-csmc-asr2") * builtupArea;
        setVal("bp-csmc-total2", total2);
        grandTotal += total2;

        // 3. City Dev Charges commercial 4%
        const total3 = 0.04 * getVal("bp-csmc-asr3") * commArea;
        setVal("bp-csmc-total3", total3);
        grandTotal += total3;

        // 4. Ancillary Area Premium 10%
        const total4 = 0.1 * getVal("bp-csmc-asr4") * getVal("bp-csmc-area4");
        setVal("bp-csmc-total4", total4);
        grandTotal += total4;

        // 5. Premium Charge For Corporation 35%
        const total5 = 0.35 * getVal("bp-csmc-asr5") * getVal("bp-csmc-area5");
        setVal("bp-csmc-total5", total5);
        grandTotal += total5;

        // 6. Labour Cess ₹254 / sq.m
        const total6 = builtupArea * 254;
        setVal("bp-csmc-total6", total6);
        grandTotal += total6;

        // 7. One Time Premium Conversion × 11
        const total7 = plotArea * 11;
        setVal("bp-csmc-total7", total7);
        grandTotal += total7;

        // 8. Fire Cess Res ₹64 / Comm ₹191
        const resArea = Math.max(0, builtupArea - commArea);
        const total8 = resArea * 64 + commArea * 191;
        setVal("bp-csmc-total8", total8);
        grandTotal += total8;

        // 9. Open Space (non-sanctioned only) 10%
        let total9 = 0;
        if (isNonSanctioned) {
            total9 = 0.1 * getVal("bp-csmc-asr9") * getVal("bp-csmc-area9");
        }
        setVal("bp-csmc-total9", total9);
        grandTotal += total9;

        setVal("bp-csmc-grandTotal", grandTotal);
    }

    function setAuthority(next) {
        authority = next === "csmc" ? "csmc" : "csmrda";
        const panelRda = document.getElementById("bp-panel-csmrda");
        const panelCsmc = document.getElementById("bp-panel-csmc");
        if (panelRda) panelRda.classList.toggle("hidden", authority !== "csmrda");
        if (panelCsmc) panelCsmc.classList.toggle("hidden", authority !== "csmc");

        document.querySelectorAll("[data-bp-authority]").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.bpAuthority === authority);
        });

        if (authority === "csmc") calculateCsmc();
        else calculateCsmrda();
    }

    function calculateBuildingPermission() {
        if (authority === "csmc") calculateCsmc();
        else calculateCsmrda();
    }

    function initBuildingPermission() {
        const root = document.getElementById("building-permission-view");
        if (!root) return;

        root.querySelectorAll("#bp-authority-selector .authority-btn").forEach((btn) => {
            btn.addEventListener("click", () => setAuthority(btn.dataset.bpAuthority));
        });

        const csmrdaPanel = document.getElementById("bp-panel-csmrda");
        if (csmrdaPanel) {
            csmrdaPanel.querySelectorAll("input, select").forEach((el) => {
                el.addEventListener("input", calculateCsmrda);
                el.addEventListener("change", calculateCsmrda);
            });
        }

        const recalc = document.getElementById("bp-recalculate");
        if (recalc) recalc.addEventListener("click", calculateCsmrda);

        const csmcPanel = document.getElementById("bp-panel-csmc");
        if (csmcPanel) {
            csmcPanel.querySelectorAll("input, select").forEach((el) => {
                if (el.id === "bp-csmc-master-asr") {
                    el.addEventListener("input", fillMasterAsr);
                    return;
                }
                if (el.id === "bp-csmc-sanctioned") {
                    el.addEventListener("change", toggleOpenSpaceRow);
                    return;
                }
                el.addEventListener("input", calculateCsmc);
                el.addEventListener("change", calculateCsmc);
            });
        }

        const clearBtn = document.getElementById("bp-csmc-clear");
        if (clearBtn) clearBtn.addEventListener("click", clearCsmc);

        setAuthority(authority);
    }

    window.initBuildingPermission = initBuildingPermission;
    window.calculateBuildingPermission = calculateBuildingPermission;
})();
