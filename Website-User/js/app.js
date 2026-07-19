/**
 * MahaCivil Website — main application logic
 */
(function () {
    let lang = "en";
    let calcType = "open-plot";
    let calcAuthority = "csmc"; // "cmrda" (10%) | "csmc" (100%) — Open Plot only
    let lastResult = null;

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    function applyI18n() {
        window.__lang = lang;
        $$("[data-i18n]").forEach((el) => {
            const key = el.getAttribute("data-i18n");
            el.textContent = t(key, lang);
        });
        $$(".lang-pill").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.lang === lang);
        });
        if (typeof window.refreshAsrDropdowns === "function") {
            window.refreshAsrDropdowns();
        }
        if (typeof window.MahaAuth !== "undefined" && typeof window.MahaAuth.refreshAuthI18n === "function") {
            window.MahaAuth.refreshAuthI18n();
        }
        if (document.body.dataset.page) {
            document.title = getPageTitle(document.body.dataset.page);
        }
    }

    function showError(id, msg) {
        const el = $(id);
        if (!el) return;
        if (msg) {
            el.textContent = msg;
            el.classList.remove("hidden");
        } else {
            el.classList.add("hidden");
        }
    }

    function parseNum(val) {
        if (val === "" || val == null) return null;
        const n = parseFloat(val);
        return isNaN(n) ? null : n;
    }

    function validateField(value, label, allowZero) {
        if (value === "" || value == null) {
            return label + " " + t("fieldRequired", lang);
        }
        const n = parseNum(value);
        if (n === null) return label + " " + t("fieldInvalid", lang);
        if (n < 0) return label + " " + t("fieldNegative", lang);
        if (!allowZero && n === 0) return label + " " + t("fieldZero", lang);
        return null;
    }

    function updateSqFtResult() {
        const sqft = $("#plot-sqft").value.trim();
        const resultEl = $("#sqft-result");
        if (!sqft) {
            resultEl.textContent = "--";
            return;
        }
        const n = parseNum(sqft);
        if (n !== null) {
            const sqm = convertSqFtToSqM(n);
            resultEl.textContent = formatArea(sqm) + " " + t("sqM", lang);
            $("#plot-sqm").value = formatArea(sqm);
        }
    }

    const PAGE_TO_VIEW = {
        home: "view-home",
        calculator: "view-home",
        services: "view-home",
        downloads: "view-home",
        about: "view-home",
        contact: "view-home",
        "asr-rates": "view-easr",
        "dp-maps": "view-dp",
    };

    const HOME_SCROLL_SECTIONS = new Set(["calculator", "services", "downloads", "about", "contact"]);

    function resolvePageKey(pageOrHash) {
        const key = String(pageOrHash || "home").replace(/^#/, "").trim();
        return PAGE_TO_VIEW[key] ? key : "home";
    }

    function getPageTitle(pageKey) {
        const suffix = " | MahaCivil";
        const titles = {
            home: t("homePageTitle", lang),
            calculator: t("navCalculator", lang) + suffix,
            "asr-rates": t("navAsr", lang) + suffix,
            "dp-maps": t("navDp", lang) + suffix,
            services: t("navServices", lang) + suffix,
            downloads: t("downloadsSectionTitle", lang) + suffix,
            about: t("navAbout", lang) + suffix,
            contact: t("navContact", lang) + suffix,
        };
        return titles[pageKey] || titles.home;
    }

    function showPage(pageKey) {
        const key = resolvePageKey(pageKey);
        const viewId = PAGE_TO_VIEW[key];
        $$(".site-view").forEach((view) => {
            view.classList.toggle("active", view.id === viewId);
        });
        $$(".nav-link").forEach((link) => {
            link.classList.toggle("active", link.dataset.page === key);
        });
        document.body.dataset.page = key;
        const hash = key === "home" ? "#home" : "#" + key;
        if (history.replaceState) {
            history.replaceState(null, "", hash);
        } else {
            location.hash = hash;
        }
        document.title = getPageTitle(key);

        if (HOME_SCROLL_SECTIONS.has(key)) {
            requestAnimationFrame(() => {
                const el = document.getElementById(key);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        } else {
            window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
        }
    }

    function initNavigation() {
        const nav = $("#site-nav");
        const menuBtn = $("#mobile-menu-btn");
        const backdrop = $("#mobile-nav-backdrop");

        function setMobileNavOpen(isOpen) {
            if (!nav) return;
            nav.classList.toggle("open", isOpen);
            document.body.classList.toggle("nav-open", isOpen);
            if (menuBtn) menuBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
            if (backdrop) {
                backdrop.classList.toggle("hidden", !isOpen);
                backdrop.setAttribute("aria-hidden", isOpen ? "false" : "true");
            }
        }

        function navigateTo(pageKey) {
            setMobileNavOpen(false);
            showPage(pageKey);
        }

        if (menuBtn) {
            menuBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!nav) return;
                setMobileNavOpen(!nav.classList.contains("open"));
            });
        }

        if (backdrop) {
            backdrop.addEventListener("click", () => setMobileNavOpen(false));
        }

        $$(".nav-link, .site-logo[data-page], a[data-page]").forEach((link) => {
            link.addEventListener("click", (e) => {
                const pageKey = link.dataset.page || (link.getAttribute("href") || "").replace(/^#/, "");
                if (!pageKey || !PAGE_TO_VIEW[pageKey]) return;
                e.preventDefault();
                navigateTo(pageKey);
            });
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && nav && nav.classList.contains("open")) {
                setMobileNavOpen(false);
            }
        });

        window.addEventListener("hashchange", () => {
            showPage(location.hash);
        });

        showPage(location.hash || "home");
    }

    function initLanguage() {
        $$(".lang-pill").forEach((btn) => {
            btn.addEventListener("click", () => {
                lang = btn.dataset.lang;
                applyI18n();
                if (lastResult) displayReceipt(lastResult);
                if (calcType === "fsi") updateFsiCalculator();
                if (calcType === "home-planning") updateHomePlanning();
            });
        });
    }

    function initCalcType() {
        $$(".calc-tab").forEach((btn) => {
            btn.addEventListener("click", () => {
                calcType = btn.dataset.calc;
                $$(".calc-tab").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                updateCalcView();
                resetReceipt();
            });
        });

        $$(".authority-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                calcAuthority = btn.dataset.authority;
                $$(".authority-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                resetReceipt();
            });
        });

        updateCalcView();
    }

    function updateCalcView() {
        const buFields = $("#built-up-fields");
        const authSel = $("#authority-selector");
        const chargeView = $("#charge-calculator-view");
        const fsiView = $("#fsi-calculator-view");
        const hpView = $("#home-planning-view");

        const showCharge = calcType === "open-plot" || calcType === "built-up";
        const showFsi = calcType === "fsi";
        const showHp = calcType === "home-planning";

        if (chargeView) chargeView.classList.toggle("hidden", !showCharge);
        if (fsiView) fsiView.classList.toggle("hidden", !showFsi);
        if (hpView) hpView.classList.toggle("hidden", !showHp);

        if (showFsi) {
            if (authSel) authSel.classList.add("hidden");
            if (buFields) buFields.classList.add("hidden");
            updateFsiCalculator();
            return;
        }

        if (showHp) {
            if (authSel) authSel.classList.add("hidden");
            if (buFields) buFields.classList.add("hidden");
            updateHomePlanning();
            return;
        }

        if (calcType === "built-up") {
            if (buFields) buFields.classList.remove("hidden");
            if (authSel) authSel.classList.add("hidden");
        } else {
            if (buFields) buFields.classList.add("hidden");
            if (authSel) authSel.classList.remove("hidden");
        }
    }

    function renderFsiSlabTable(activeId) {
        const tbody = $("#fsi-slab-tbody");
        if (!tbody || typeof FSI_SLABS === "undefined") return;
        tbody.innerHTML = FSI_SLABS.map((s) => {
            const active = s.id === activeId ? " active" : "";
            const prem = s.prem > 0 ? formatFsiFsi(s.prem) : "—";
            const tdr = s.tdr > 0 ? formatFsiFsi(s.tdr) : "—";
            const label = lang === "mr" ? s.labelMr : s.labelEn;
            return `<tr class="fsi-slab-row${active}" data-slab="${s.id}">
                <td>${label}</td>
                <td>${formatFsiFsi(s.basic)}</td>
                <td>${prem}</td>
                <td>${tdr}</td>
                <td>${formatFsiFsi(s.maxPotential)}</td>
            </tr>`;
        }).join("");
    }

    function updateFsiCalculator() {
        const plotEl = $("#fsi-plot-area");
        const roadEl = $("#fsi-road-width");
        const premSlider = $("#fsi-prem-slider");
        const tdrSlider = $("#fsi-tdr-slider");
        if (!plotEl || !roadEl || !premSlider || !tdrSlider) return;

        const plot = parseNum(plotEl.value);
        const road = parseNum(roadEl.value);
        const slab = typeof findFsiSlab === "function" ? findFsiSlab(roadEl.value.trim() === "" ? NaN : road) : null;

        const badge = $("#fsi-slab-badge");
        if (badge) {
            if (!slab || roadEl.value.trim() === "") {
                badge.textContent = t("fsiEnterRoad", lang);
                badge.classList.remove("active");
            } else {
                const label = lang === "mr" ? slab.labelMr : slab.labelEn;
                badge.textContent = t("fsiSlabBadge", lang)
                    .replace("{road}", formatFsiFsi(road))
                    .replace("{slab}", label);
                badge.classList.add("active");
            }
        }

        const premMax = slab ? slab.prem : 0;
        const tdrMax = slab ? slab.tdr : 0;

        premSlider.max = String(premMax);
        tdrSlider.max = String(tdrMax);
        premSlider.disabled = premMax <= 0;
        tdrSlider.disabled = tdrMax <= 0;

        let premVal = parseFloat(premSlider.value) || 0;
        let tdrVal = parseFloat(tdrSlider.value) || 0;
        if (premVal > premMax) premVal = premMax;
        if (tdrVal > tdrMax) tdrVal = tdrMax;
        if (premMax <= 0) premVal = 0;
        if (tdrMax <= 0) tdrVal = 0;
        premSlider.value = String(premVal);
        tdrSlider.value = String(tdrVal);

        const premValueEl = $("#fsi-prem-value");
        const tdrValueEl = $("#fsi-tdr-value");
        if (premValueEl) premValueEl.textContent = formatFsiFsi(premVal) + " / " + formatFsiFsi(premMax);
        if (tdrValueEl) tdrValueEl.textContent = formatFsiFsi(tdrVal) + " / " + formatFsiFsi(tdrMax);

        const result = calculateFsi(plot || 0, roadEl.value.trim() === "" ? NaN : road, premVal, tdrVal);

        const setText = (id, val) => {
            const el = $(id);
            if (el) el.textContent = formatFsiArea(val);
        };
        setText("#fsi-basic-area", result.basicArea);
        setText("#fsi-prem-area", result.premArea);
        setText("#fsi-tdr-area", result.tdrArea);
        setText("#fsi-max-area", result.maxArea);
        setText("#fsi-total-area", result.totalArea);

        const capNote = $("#fsi-cap-note");
        if (capNote) {
            capNote.textContent = result.capped ? t("fsiCapCapped", lang) : t("fsiCapWithin", lang);
            capNote.classList.toggle("capped", !!result.capped);
        }

        renderFsiSlabTable(result.slab ? result.slab.id : null);
    }

    function initFsiCalculator() {
        const plotEl = $("#fsi-plot-area");
        const roadEl = $("#fsi-road-width");
        const premSlider = $("#fsi-prem-slider");
        const tdrSlider = $("#fsi-tdr-slider");
        if (!plotEl || !roadEl) return;

        const onNumeric = (e) => {
            if (!/^\d*\.?\d*$/.test(e.target.value) && e.target.value !== "") {
                e.target.value = e.target.value.replace(/[^\d.]/g, "");
            }
            updateFsiCalculator();
        };

        plotEl.addEventListener("input", onNumeric);
        roadEl.addEventListener("input", onNumeric);
        if (premSlider) premSlider.addEventListener("input", updateFsiCalculator);
        if (tdrSlider) tdrSlider.addEventListener("input", updateFsiCalculator);

        renderFsiSlabTable(null);
        updateFsiCalculator();
    }

    let hpUnit = "sqft";
    let hpQuality = "medium";

    function updateHomePlanning() {
        if (typeof calculateHomePlanning !== "function") return;
        const areaEl = $("#hp-area");
        if (!areaEl) return;
        const area = parseNum(areaEl.value) || 0;
        const result = calculateHomePlanning(area, hpUnit, hpQuality);

        const costSqftEl = $("#hp-cost-sqft");
        const totalEl = $("#hp-total-cost");
        if (costSqftEl) costSqftEl.textContent = formatHomePlanningInr(result.costPerSqFt);
        if (totalEl) totalEl.textContent = formatHomePlanningInr(result.totalCost);

        const phaseBody = $("#hp-phase-tbody");
        if (phaseBody) {
            phaseBody.innerHTML = result.phases.map((p) => {
                const name = lang === "mr" ? p.nameMr : p.nameEn;
                return `<tr>
                    <td>${name}</td>
                    <td>${p.pct}%</td>
                    <td>${formatHomePlanningInr(p.amount)}</td>
                </tr>`;
            }).join("");
        }

        const resBody = $("#hp-resource-tbody");
        if (resBody) {
            resBody.innerHTML = result.resources.map((r) => {
                const name = lang === "mr" ? r.nameMr : r.nameEn;
                const unit = lang === "mr" ? r.unitMr : r.unitEn;
                return `<tr>
                    <td>${name}</td>
                    <td>${formatHomePlanningQty(r.qty)} ${unit}</td>
                    <td>${formatHomePlanningInr(r.rate)}</td>
                    <td>${formatHomePlanningInr(r.amount)}</td>
                </tr>`;
            }).join("");
        }
    }

    function initHomePlanning() {
        const areaEl = $("#hp-area");
        if (!areaEl) return;

        areaEl.addEventListener("input", (e) => {
            if (!/^\d*\.?\d*$/.test(e.target.value) && e.target.value !== "") {
                e.target.value = e.target.value.replace(/[^\d.]/g, "");
            }
            updateHomePlanning();
        });

        $$(".hp-unit-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                hpUnit = btn.dataset.unit;
                $$(".hp-unit-btn").forEach((b) => b.classList.toggle("active", b === btn));
                updateHomePlanning();
            });
        });

        $$(".hp-quality-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                hpQuality = btn.dataset.quality;
                $$(".hp-quality-btn").forEach((b) => b.classList.toggle("active", b === btn));
                updateHomePlanning();
            });
        });

        updateHomePlanning();
    }

    function resetReceipt() {
        $("#receipt").classList.add("hidden");
        $("#receipt").innerHTML = "";
        $("#result-placeholder").classList.remove("hidden");
        $("#btn-pdf").disabled = true;
        lastResult = null;
    }

    function initSteppers() {
        $$(".step-up, .step-down").forEach((btn) => {
            btn.addEventListener("click", () => {
                const target = $("#" + btn.dataset.target);
                const step = parseFloat(btn.dataset.step);
                let val = parseNum(target.value) || 0;
                if (btn.classList.contains("step-up")) {
                    val += step;
                } else {
                    val = Math.max(0, val - step);
                }
                target.value = step < 1 ? formatArea(val) : (val % 1 === 0 ? String(val) : formatArea(val));
                if (btn.dataset.target === "plot-sqft") updateSqFtResult();
            });
        });
    }

    function initInputs() {
        $("#plot-sqft").addEventListener("input", (e) => {
            if (/^\d*\.?\d*$/.test(e.target.value) || e.target.value === "") {
                updateSqFtResult();
            }
        });
        ["plot-sqm", "asr-rate", "bu-res", "bu-comm", "bu-margins"].forEach((id) => {
            const el = $("#" + id);
            if (el) {
                el.addEventListener("input", (e) => {
                    if (!/^\d*\.?\d*$/.test(e.target.value) && e.target.value !== "") {
                        e.target.value = e.target.value.replace(/[^\d.]/g, "");
                    }
                });
            }
        });
    }

    function displayReceipt(result) {
        const receipt = $("#receipt");
        const placeholder = $("#result-placeholder");
        receipt.innerHTML = renderReceipt(result, lang);
        receipt.classList.remove("hidden");
        placeholder.classList.add("hidden");
        $("#btn-pdf").disabled = false;

        if (window.MahaAuth && typeof window.MahaAuth.markFeatureUsed === "function") {
            window.MahaAuth.markFeatureUsed("usedCalculator");
        }

        if (window.matchMedia("(max-width: 768px)").matches) {
            const resultSection = $("#receipt-section");
            if (resultSection) {
                setTimeout(() => {
                    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 80);
            }
        }
    }

    function executeCalculate() {
        const plotSqM = parseNum($("#plot-sqm").value);
        const asrRate = parseNum($("#asr-rate").value);

        if (calcType === "open-plot") {
            lastResult = calculateOpenPlot(plotSqM, asrRate, calcAuthority);
        } else if (calcType === "built-up") {
            lastResult = calculateBuiltUp(
                plotSqM, asrRate,
                parseNum($("#bu-res").value) || 0,
                parseNum($("#bu-comm").value) || 0,
                parseNum($("#bu-margins").value) || 0
            );
        } else {
            return;
        }

        displayReceipt(lastResult);
    }

    function runCalculate() {
        if (calcType === "fsi" || calcType === "home-planning") return;

        ["err-plot-sqft", "err-plot-sqm", "err-asr-rate", "err-bu-res", "err-bu-comm", "err-bu-margins"].forEach((id) => showError("#" + id, null));

        const sqftErr = validateField($("#plot-sqft").value.trim(), t("plotAreaSqM", lang), false);
        const sqmErr = validateField($("#plot-sqm").value.trim(), t("plotAreaSqM", lang), false);
        const asrErr = validateField($("#asr-rate").value.trim(), t("asrRate", lang), false);

        showError("#err-plot-sqft", sqftErr);
        showError("#err-plot-sqm", sqmErr);
        showError("#err-asr-rate", asrErr);

        if (sqftErr || sqmErr || asrErr) return;

        if (calcType === "built-up") {
            const resErr = validateField($("#bu-res").value.trim(), t("builtUpRes", lang), true);
            const commErr = validateField($("#bu-comm").value.trim(), t("builtUpComm", lang), true);
            const margErr = validateField($("#bu-margins").value.trim(), t("builtUpMargins", lang), true);
            showError("#err-bu-res", resErr);
            showError("#err-bu-comm", commErr);
            showError("#err-bu-margins", margErr);
            if (resErr || commErr || margErr) return;
        }

        // Login temporarily disabled — show results without auth
        // if (window.MahaAuth && typeof window.MahaAuth.requireAuth === "function") {
        //     window.MahaAuth.requireAuth(executeCalculate);
        // } else {
        //     executeCalculate();
        // }
        executeCalculate();
    }

    function initCalculate() {
        $("#btn-calculate").addEventListener("click", runCalculate);
        $("#btn-pdf").addEventListener("click", () => {
            if (!lastResult) {
                alert(t("calculateFirst", lang));
                return;
            }
            openPrintWindow(
                t(lastResult.type === "open-plot" ? "openPlotCharges" : "builtUpCharges", lang),
                buildPrintReceiptHtml(lastResult, lang)
            );
        });
    }

    function initSectors() {
        const list = $("#sector-list");
        SECTORS.forEach((sector) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "sector-btn";
            btn.textContent = sector.name;
            btn.addEventListener("click", () => openMapViewer(sector.name, sectorUrl(sector.slug)));
            list.appendChild(btn);
        });
    }

    function openMapViewer(title, url) {
        $("#map-sector-name").textContent = title;
        $("#map-frame").src = url;
        $("#map-viewer").classList.remove("hidden");
        document.body.style.overflow = "hidden";
    }

    function closeMapViewer() {
        $("#map-frame").src = "about:blank";
        $("#map-viewer").classList.add("hidden");
        document.body.style.overflow = "";
    }

    function initMapViewer() {
        $("#map-close").addEventListener("click", closeMapViewer);
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !$("#map-viewer").classList.contains("hidden")) {
                closeMapViewer();
            }
        });
    }

    function initFooter() {
        const yearEl = $("#year");
        if (yearEl) yearEl.textContent = new Date().getFullYear();
        initVisitorCounter();
    }

    function formatVisitorCount(n) {
        const num = Number(n) || 0;
        try {
            return num.toLocaleString(lang === "mr" ? "mr-IN" : "en-IN");
        } catch (_) {
            return String(num);
        }
    }

    function initVisitorCounter() {
        const countEl = $("#visitor-count");
        if (!countEl || typeof firebase === "undefined") return;

        try {
            if (!firebase.apps.length && window.MahaAuth && typeof window.MahaAuth.init === "function") {
                window.MahaAuth.init();
            }
            if (!firebase.apps.length) return;

            const ref = firebase.database().ref("stats/visitCount");
            const SESSION_FLAG = "mahacivil_visit_counted";

            // Show live count (updates when others visit too)
            ref.on("value", (snap) => {
                const val = snap.val();
                countEl.textContent = formatVisitorCount(val == null ? 0 : val);
            });

            // Count this browser session once
            let alreadyCounted = false;
            try {
                alreadyCounted = sessionStorage.getItem(SESSION_FLAG) === "1";
            } catch (_) { /* ignore */ }

            if (!alreadyCounted) {
                ref.transaction((current) => {
                    const n = Number(current) || 0;
                    return n + 1;
                }).then((result) => {
                    if (result.committed) {
                        try { sessionStorage.setItem(SESSION_FLAG, "1"); } catch (_) { /* ignore */ }
                    }
                }).catch(() => {
                    // Permission denied or offline — leave shown value as-is
                });
            }
        } catch (_) {
            // Keep placeholder if Firebase is unavailable
        }
    }

    function openDevModal() {
        const modal = $("#dev-modal");
        if (!modal) return;
        modal.classList.remove("hidden");
        document.body.classList.add("dialog-open");
    }

    function closeDevModal() {
        const modal = $("#dev-modal");
        if (!modal) return;
        modal.classList.add("hidden");
        document.body.classList.remove("dialog-open");
    }

    function initDeveloperModal() {
        const openBtn = $("#developed-by-btn");
        const closeBtn = $("#dev-modal-close");
        const okBtn = $("#dev-modal-ok");
        const backdrop = $("#dev-modal-backdrop");

        if (openBtn) openBtn.addEventListener("click", openDevModal);
        if (closeBtn) closeBtn.addEventListener("click", closeDevModal);
        if (okBtn) okBtn.addEventListener("click", closeDevModal);
        if (backdrop) backdrop.addEventListener("click", closeDevModal);

        document.addEventListener("keydown", (e) => {
            const modal = $("#dev-modal");
            if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
                closeDevModal();
            }
        });
    }

    function init() {
        applyI18n();
        initNavigation();
        initLanguage();
        initCalcType();
        initSteppers();
        initInputs();
        initCalculate();
        initFsiCalculator();
        initHomePlanning();
        initSectors();
        initMapViewer();
        initFooter();
        initDeveloperModal();
        if (typeof window.initAsr === "function") {
            window.initAsr();
        }
        if (typeof window.initCalcAsr === "function") {
            window.initCalcAsr();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
