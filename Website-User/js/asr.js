/**
 * eASR Rates — live lookup via Node.js API (HTTP scraper, no browser)
 */
(function () {
    const $ = (sel) => document.querySelector(sel);

    const DISTRICT_EN = "Chhatrapati Sambhajinagar";
    const DISTRICT_MR = "छत्रपती संभाजीनगर";

    let lastAsrResult = null;
    let ratesFetchGeneration = 0;

    const RATES_POLL_INTERVAL_MS = 2500;
    const RATES_MAX_POLLS = 120;

    function getApiBase() {
        if (window.ASR_API_BASE) return window.ASR_API_BASE.replace(/\/$/, "");
        if (window.location.protocol === "file:" || window.location.port !== "8000") {
            return "http://127.0.0.1:8000";
        }
        return window.location.origin;
    }

    function getLang() {
        return window.__lang || "en";
    }

    function getDistrictLabel(lang) {
        return lang === "mr" ? DISTRICT_MR : DISTRICT_EN;
    }

    function formatRate(n) {
        return String(Number(n));
    }

    function flattenEntries(data) {
        const rows = [];
        (data.entries || []).forEach((entry) => {
            (entry.rates || []).forEach((rate) => {
                if (Number(rate.rate) === 0) return;
                rows.push({
                    vibhagNo: entry.vibhagNo,
                    assessmentType: entry.assessmentType,
                    assessmentRange: rate.assessmentRange || "",
                    rate: rate.rate,
                    unit: rate.unit || ""
                });
            });
        });
        return rows;
    }

    function hasUnitColumn(rows) {
        return rows.some((r) => r.unit && r.unit.trim());
    }

    function updateDistrictField() {
        const field = $("#asr-district");
        if (!field) return;
        field.value = getDistrictLabel(getLang());
    }

    function formatApiError(err, lang, fallbackKey) {
        const isNetwork =
            err.name === "TypeError" ||
            (err.message && err.message.toLowerCase().includes("failed to fetch"));
        const isPlaywright =
            err.message && (
                err.message.includes("playwright install") ||
                err.message.includes("Executable doesn't exist") ||
                err.message.includes("Playwright browser not installed") ||
                err.message.includes("temporarily unavailable")
            );
        if (isNetwork) return t("asrServerDown", lang);
        if (isPlaywright) return t("asrServiceUnavailable", lang);
        const short = err.message ? err.message.split("║")[0].trim() : "";
        const fallback = t(fallbackKey, lang);
        if (!short || short === fallback) return fallback;
        return `${fallback}: ${short}`;
    }

    async function loadStaticLocations() {
        const url = `${getApiBase()}/data/asr-locations.json`;
        console.log("[asr] loading static locations:", url);
        const res = await fetch(url);
        console.log("[asr] static locations response:", res.status, res.headers.get("content-type"));
        if (!res.ok) throw new Error("static locations unavailable");
        return res.json();
    }

    async function loadStaticTalukas(select, lang, previous) {
        const data = await loadStaticLocations();
        const names = (data.talukas || [])
            .map((item) => (typeof item === "string" ? item : item.name))
            .filter(Boolean);
        if (!names.length) throw new Error("no talukas");
        fillSelect(select, names, t("asrSelectTaluka", lang), previous);
        setStatus("", false);
    }

    function normalizeTalukaName(value) {
        return String(value || "")
            .trim()
            .normalize("NFC")
            .replace(/\s+/g, " ");
    }

    function talukaNamesMatch(requested, candidate) {
        const a = normalizeTalukaName(requested);
        const b = normalizeTalukaName(candidate);
        if (!a || !b) return false;
        if (a === b) return true;
        return a.includes(b) || b.includes(a);
    }

    async function loadStaticVillages(talukaName, select, lang, previous) {
        const data = await loadStaticLocations();
        const primary = data.talukas && data.talukas[0] && data.talukas[0].name;
        if (!primary || !talukaNamesMatch(talukaName, primary)) {
            throw new Error("no static villages for taluka");
        }
        const villages = data.villages || [];
        if (!villages.length) throw new Error("no villages");
        fillSelect(select, villages, t("asrChooseVillage", lang), previous);
        setStatus("", false);
    }

    function setSelectLoading(select, message, disabled) {
        if (!select) return;
        select.innerHTML = "";
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = message;
        select.appendChild(opt);
        select.disabled = disabled;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function apiGet(path, timeoutMs = 30000) {
        const url = `${getApiBase()}${path}`;
        console.log("[asr] apiGet:", url);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { signal: controller.signal });
            console.log("[asr] apiGet response:", res.status, res.headers.get("content-type"));
            const contentType = res.headers.get("content-type") || "";
            const data = contentType.includes("application/json") ? await res.json() : null;
            if (!res.ok) {
                const detail = data && data.detail
                    ? (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail))
                    : `HTTP ${res.status}`;
                throw new Error(detail);
            }
            return data;
        } catch (err) {
            if (err.name === "AbortError") {
                throw new Error("Request timed out. Please try again.");
            }
            console.log("[asr] apiGet error:", err.name, err.message);
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    function fillSelect(select, items, placeholderText, previousValue) {
        select.innerHTML = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = placeholderText;
        select.appendChild(placeholder);

        items.forEach((name) => {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });

        select.disabled = false;
        if (previousValue && items.includes(previousValue)) {
            select.value = previousValue;
        }
    }

    async function loadTalukas() {
        const select = $("#asr-taluka");
        const lang = getLang();
        if (!select) return;

        const previous = select.value;
        setSelectLoading(select, t("asrLoadingTalukas", lang), true);

        try {
            await loadStaticTalukas(select, lang, previous);
            if (select.value) {
                await loadVillages(select.value);
            } else {
                setSelectLoading($("#asr-village"), t("asrSelectVillage", lang), true);
            }
            return;
        } catch (_) { /* no bundled talukas */ }

        try {
            const data = await apiGet("/get-talukas");
            fillSelect(select, data.talukas || [], t("asrSelectTaluka", lang), previous);
            if (select.value) {
                await loadVillages(select.value);
            } else {
                setSelectLoading($("#asr-village"), t("asrSelectVillage", lang), true);
            }
        } catch (err) {
            try {
                await loadStaticTalukas(select, lang, previous);
                if (select.value) {
                    await loadVillages(select.value);
                } else {
                    setSelectLoading($("#asr-village"), t("asrSelectVillage", lang), true);
                }
                return;
            } catch (_) { /* fall through */ }
            setSelectLoading(select, t("asrLoadTalukasFailed", lang), true);
            setStatus(formatApiError(err, lang, "asrLoadTalukasFailed"), true);
        }
    }

    async function checkServer() {
        const lang = getLang();
        try {
            await apiGet("/health", 8000);
            return true;
        } catch (_) {
            setStatus(
                lang === "mr"
                    ? "सर्वर सुरू नाही. npm start चालवा."
                    : "Server not running. Run: npm start",
                true
            );
            return false;
        }
    }

    async function loadVillages(talukaName) {
        const select = $("#asr-village");
        const lang = getLang();
        if (!select) return;

        if (!talukaName) {
            setSelectLoading(select, t("asrSelectVillage", lang), true);
            return;
        }

        const previous = select.value;
        setSelectLoading(select, t("asrLoadingVillages", lang), true);

        try {
            const data = await apiGet(
                `/get-villages?taluka=${encodeURIComponent(talukaName)}`,
                60000
            );
            const villages = data.villages || [];
            if (!villages.length) {
                setSelectLoading(select, t("asrNoVillages", lang), true);
                return;
            }
            fillSelect(select, villages, t("asrChooseVillage", lang), previous);
            setStatus("", false);
        } catch (err) {
            try {
                await loadStaticVillages(talukaName, select, lang, previous);
                return;
            } catch (_) { /* fall through */ }
            setSelectLoading(select, t("asrLoadVillagesFailed", lang), true);
            setStatus(formatApiError(err, lang, "asrLoadVillagesFailed"), true);
        }
    }

    function setPdfEnabled(enabled) {
        const btn = $("#asr-pdf-btn");
        if (btn) btn.disabled = !enabled;
    }

    function clearResults() {
        lastAsrResult = null;
        setPdfEnabled(false);
        const container = $("#asr-results");
        const placeholder = $("#asr-placeholder");
        if (container) {
            container.innerHTML = "";
            container.classList.add("hidden");
        }
        if (placeholder) placeholder.classList.remove("hidden");
    }

    function renderResults(data, lang) {
        const container = $("#asr-results");
        const placeholder = $("#asr-placeholder");
        if (!container) return;

        const rows = flattenEntries(data);
        const vibhagNo = rows.length ? rows[0].vibhagNo : (data.entries && data.entries[0] && data.entries[0].vibhagNo);
        const showUnit = hasUnitColumn(rows);

        let html = `
            <div class="asr-portal-panel">
                <div class="asr-portal-title">${t("asrPortalTitle", lang)}</div>
                <div class="asr-selection-grid">
                    <div class="asr-selection-item">
                        <span class="asr-selection-label">${t("asrSelectedDistrict", lang)}</span>
                        <span class="asr-selection-value">${getDistrictLabel(lang)}</span>
                    </div>
                    <div class="asr-selection-item">
                        <span class="asr-selection-label">${t("asrTaluka", lang)}</span>
                        <span class="asr-selection-value">${data.taluka}</span>
                    </div>
                    <div class="asr-selection-item">
                        <span class="asr-selection-label">${t("asrVillage", lang)}</span>
                        <span class="asr-selection-value">${data.village}</span>
                    </div>
                </div>
        `;

        if (vibhagNo != null) {
            html += `
                <div class="asr-vibhag-row">
                    <span class="asr-selection-label">${t("asrVibhagNumber", lang)}</span>
                    <span class="asr-vibhag-value">${vibhagNo}</span>
                </div>
            `;
        }

        // Survey number bar
        if (data.hasSurveyNumbers && data.surveyNumbers && data.surveyNumbers.length) {
            const selected = data.selectedSurvey || data.surveyNumbers[0];
            html += `<div class="asr-survey-bar">`;
            html += `<span class="asr-survey-label">${t("asrSurveyNo", lang)}:</span>`;
            data.surveyNumbers.forEach((sn) => {
                const active = sn === selected ? " active" : "";
                html += `<button type="button" class="asr-survey-chip${active}" data-survey="${sn}">${sn}</button>`;
            });
            html += `</div>`;
        }

        if (!rows.length) {
            html += `<p class="muted asr-no-data">${t("asrNoData", lang)}</p>`;
        } else {
            html += `
                <div class="asr-table-wrap">
                    <table class="asr-table asr-table-gov">
                        <thead>
                            <tr>
                                <th>${t("asrAssessmentType", lang)}</th>
                                <th>${t("asrRange", lang)}</th>
                                <th>${t("asrRateCol", lang)}</th>
                                ${showUnit ? `<th>${t("asrUnit", lang)}</th>` : ""}
                            </tr>
                        </thead>
                        <tbody>
            `;
            rows.forEach((row) => {
                html += `
                    <tr>
                        <td class="asr-type-cell">${row.assessmentType}</td>
                        <td class="asr-range-cell">${row.assessmentRange || "—"}</td>
                        <td class="asr-rate-cell">${formatRate(row.rate)}</td>
                        ${showUnit ? `<td>${row.unit || "—"}</td>` : ""}
                    </tr>
                `;
            });
            html += `</tbody></table></div>`;
            html += `<p class="asr-footnote">${t("asrAllPagesNote", lang)} · ${rows.length} ${t("asrRowCount", lang)}</p>`;
        }

        html += `</div>`;

        container.innerHTML = html;
        container.classList.remove("hidden");
        placeholder.classList.add("hidden");
        lastAsrResult = data;
        setPdfEnabled(rows.length > 0);

        if (rows.length > 0 && window.MahaAuth && typeof window.MahaAuth.markFeatureUsed === "function") {
            window.MahaAuth.markFeatureUsed("usedEasar");
        }
    }

    function setStatus(msg, isError) {
        const el = $("#asr-status");
        if (!el) return;
        el.textContent = msg || "";
        el.classList.toggle("asr-error", !!isError);
    }

    async function pollRatesJob(taluka, village, gen, lang) {
        const data = await apiGet(
            `/get-rates?taluka=${encodeURIComponent(taluka)}&village=${encodeURIComponent(village)}`,
            90000
        );
        if (data && data.entries) return data;
        throw new Error("No rate entries returned.");
    }

    async function fetchRates() {
        const taluka = $("#asr-taluka").value;
        const village = $("#asr-village").value;
        const lang = getLang();
        const btn = $("#asr-fetch-btn");

        if (!taluka || !village) {
            setStatus(t("asrValidation", lang), true);
            return;
        }

        const gen = ++ratesFetchGeneration;
        setStatus(t("asrLoading", lang), false);
        btn.disabled = true;
        setPdfEnabled(false);

        try {
            const data = await pollRatesJob(taluka, village, gen, lang);
            if (!data || gen !== ratesFetchGeneration) return;
            renderResults(data, lang);
            setStatus(t("asrSuccess", lang), false);
        } catch (err) {
            if (gen !== ratesFetchGeneration) return;
            clearResults();
            setStatus(formatApiError(err, lang, "asrError"), true);
        } finally {
            if (gen === ratesFetchGeneration) {
                btn.disabled = false;
            }
        }
    }

    function initAsr() {
        const talukaSelect = $("#asr-taluka");
        const fetchBtn = $("#asr-fetch-btn");
        const pdfBtn = $("#asr-pdf-btn");
        if (!talukaSelect || !fetchBtn) return;

        updateDistrictField();
        checkServer().then((ok) => {
            if (ok) loadTalukas();
        });
        setPdfEnabled(false);

        talukaSelect.addEventListener("change", (e) => {
            ratesFetchGeneration++;
            clearResults();
            loadVillages(e.target.value);
        });

        $("#asr-village")?.addEventListener("change", () => {
            ratesFetchGeneration++;
            clearResults();
        });

        // Survey chip click delegation on the results container
        const resultsContainer = $("#asr-results");
        if (resultsContainer) {
            resultsContainer.addEventListener("click", (e) => {
                const chip = e.target.closest(".asr-survey-chip");
                if (!chip || !lastAsrResult) return;
                const surveyNo = chip.dataset.survey;
                if (lastAsrResult.hasSurveyNumbers && lastAsrResult.surveyData && lastAsrResult.surveyData[surveyNo]) {
                    lastAsrResult.entries = lastAsrResult.surveyData[surveyNo];
                    lastAsrResult.selectedSurvey = surveyNo;
                    renderResults(lastAsrResult, getLang());
                }
            });
        }

        fetchBtn.addEventListener("click", fetchRates);

        if (pdfBtn) {
            pdfBtn.addEventListener("click", () => {
                const lang = getLang();
                if (!lastAsrResult || !flattenEntries(lastAsrResult).length) {
                    setStatus(t("asrFetchFirst", lang), true);
                    return;
                }
                printAsrRates(lastAsrResult, lang);
            });
        }
    }

    window.initAsr = initAsr;
    window.refreshAsrDropdowns = function () {
        updateDistrictField();
        loadTalukas();
    };
})();
