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
    if (window.ASR_API_BASE) {
        return window.ASR_API_BASE.replace(/\/$/, "");
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

    // Detect whether entries use the new multi-column format (has subzone field)
    // or the old grouped format (has assessmentType + rates[])
    function isNewFormat(data) {
        const first = (data.entries || [])[0];
        return first && ("subzone" in first || "openLand" in first);
    }

    // Flatten old-format entries into display rows (backward compat)
    function flattenEntries(data) {
        if (isNewFormat(data)) return data.entries || [];
        const rows = [];
        (data.entries || []).forEach((entry) => {
            (entry.rates || []).forEach((rate) => {
                if (Number(rate.rate) === 0) return;
                rows.push({
                    vibhagNo: entry.vibhagNo,
                    subzone: rate.assessmentRange
                        ? `${entry.assessmentType} — ${rate.assessmentRange}`
                        : entry.assessmentType,
                    openLand: rate.rate,
                    unit: rate.unit || "",
                });
            });
        });
        return rows;
    }

    // Which rate columns have at least one non-zero value?
    function detectColumns(rows) {
        return {
            openLand:    rows.some((r) => r.openLand    > 0),
            residential: rows.some((r) => r.residential > 0),
            office:      rows.some((r) => r.office      > 0),
            shop:        rows.some((r) => r.shop        > 0),
            industrial:  rows.some((r) => r.industrial  > 0),
            unit:        rows.some((r) => r.unit && r.unit.trim()),
            hasSurvey:   rows.some((r) => r.hasSurvey),
        };
    }

    function hasUnitColumn(rows) {
        return rows.some((r) => r.unit && r.unit.trim());
    }

    function renderPaginationBar(pagination, extraClass = "") {
        if (!pagination || !pagination.items || !pagination.items.length) return "";
        const current = pagination.currentPage || 1;
        let html = `<div class="asr-pagination${extraClass ? ` ${extraClass}` : ""}">`;
        pagination.items.forEach((item) => {
            if (!item || item.type === "page") {
                const page = item && item.page != null ? item.page : item;
                if (page === current) {
                    html += `<span class="asr-page-current">${page}</span>`;
                } else {
                    html += `<button type="button" class="asr-page-link" data-page="${page}">${page}</button>`;
                }
            } else if (item.type === "ellipsis") {
                if (item.page) {
                    html += `<button type="button" class="asr-page-link asr-page-ellipsis" data-page="${item.page}" title="">…</button>`;
                } else {
                    html += `<span class="asr-page-ellipsis">…</span>`;
                }
            }
        });
        html += `</div>`;
        return html;
    }

    function pageFootnote(data, rowCount, lang) {
        const page = (data.pagination && data.pagination.currentPage) || 1;
        const note = t("asrPageNote", lang).replace("{page}", page);
        return `${note} · ${rowCount} ${t("asrRowCount", lang)}`;
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

    function fillSelect(select, items, placeholderText, previousValue, autoSelectFirst) {
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
        } else if (autoSelectFirst && items.length > 0) {
            select.value = items[0];
        }
    }

    async function loadTalukas() {
        const select = $("#asr-taluka");
        const lang = getLang();
        if (!select) return;

        const previous = select.value;
        setSelectLoading(select, t("asrLoadingTalukas", lang), true);

        try {
            const data = await loadStaticLocations();
            const names = (data.talukas || [])
                .map((item) => (typeof item === "string" ? item : item.name))
                .filter(Boolean);
            if (!names.length) throw new Error("no talukas");
            fillSelect(select, names, t("asrSelectTaluka", lang), previous, true);
            setStatus("", false);
            if (select.value) await loadVillages(select.value);
            return;
        } catch (_) { /* fall through */ }

        try {
            const data = await apiGet("/get-talukas");
            fillSelect(select, data.talukas || [], t("asrSelectTaluka", lang), previous, true);
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
        const cols = detectColumns(rows);

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

        // Survey number section selector (when portal uses separate survey dropdowns)
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
            html += `<div class="asr-table-wrap"><table class="asr-table asr-table-gov"><thead><tr>`;
            html += `<th class="asr-th-subzone">${t("asrSubzone", lang)}</th>`;
            if (cols.openLand)    html += `<th>${t("asrOpenLand", lang)}</th>`;
            if (cols.residential) html += `<th>${t("asrResidential", lang)}</th>`;
            if (cols.office)      html += `<th>${t("asrOffice", lang)}</th>`;
            if (cols.shop)        html += `<th>${t("asrShop", lang)}</th>`;
            if (cols.industrial)  html += `<th>${t("asrIndustrial", lang)}</th>`;
            if (cols.unit)        html += `<th>${t("asrUnit", lang)}</th>`;
            if (cols.hasSurvey)   html += `<th></th>`;
            html += `</tr></thead><tbody>`;

            rows.forEach((row, idx) => {
                html += `<tr>`;
                const subzoneLabel = row.zoneNo
                    ? `<span class="asr-zone-no">${row.zoneNo}</span> ${row.subzone || "—"}`
                    : (row.subzone || "—");
                html += `<td class="asr-subzone-cell">${subzoneLabel}</td>`;
                if (cols.openLand)    html += `<td class="asr-rate-cell">${row.openLand    > 0 ? formatRate(row.openLand)    : "—"}</td>`;
                if (cols.residential) html += `<td class="asr-rate-cell">${row.residential > 0 ? formatRate(row.residential) : "—"}</td>`;
                if (cols.office)      html += `<td class="asr-rate-cell">${row.office      > 0 ? formatRate(row.office)      : "—"}</td>`;
                if (cols.shop)        html += `<td class="asr-rate-cell">${row.shop        > 0 ? formatRate(row.shop)        : "—"}</td>`;
                if (cols.industrial)  html += `<td class="asr-rate-cell">${row.industrial  > 0 ? formatRate(row.industrial)  : "—"}</td>`;
                if (cols.unit)        html += `<td class="asr-unit-cell">${row.unit || "—"}</td>`;
                if (cols.hasSurvey)   html += `<td class="asr-survey-cell">${row.hasSurvey ? `<button type="button" class="asr-survey-row-btn" data-row="${idx}" title="${t("asrSurveyNumbers", lang)}">📋 ${t("asrSurveysBtn", lang)}</button>` : ""}</td>`;
                html += `</tr>`;
                // Survey number expand area (initially hidden)
                if (row.hasSurvey) {
                    const colspan = 1 + (cols.openLand?1:0) + (cols.residential?1:0) + (cols.office?1:0) +
                                    (cols.shop?1:0) + (cols.industrial?1:0) + (cols.unit?1:0) + 1;
                    html += `<tr class="asr-survey-expand-row hidden" data-expand-row="${idx}">
                        <td colspan="${colspan}" class="asr-survey-expand-cell">
                            <div class="asr-survey-expand-content" id="asr-survey-expand-${idx}">
                                <span class="asr-survey-loading">${t("asrLoadingSurveys", lang)}</span>
                            </div>
                        </td>
                    </tr>`;
                }
            });

            html += `</tbody></table></div>`;
            html += renderPaginationBar(data.pagination);
            html += `<p class="asr-footnote">${pageFootnote(data, rows.length, lang)}</p>`;
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

    async function pollRatesJob(taluka, village, gen, lang, page = 1) {
        const pageParam = page > 1 ? `&page=${page}` : "";
        const data = await apiGet(
            `/get-rates?taluka=${encodeURIComponent(taluka)}&village=${encodeURIComponent(village)}${pageParam}`,
            90000
        );
        if (data && data.entries) return data;
        throw new Error("No rate entries returned.");
    }

    async function loadRatesPage(page) {
        const taluka = $("#asr-taluka").value;
        const village = $("#asr-village").value;
        const lang = getLang();
        const btn = $("#asr-fetch-btn");

        if (!taluka || !village) return;

        const gen = ++ratesFetchGeneration;
        setStatus(t("asrLoading", lang), false);
        if (btn) btn.disabled = true;

        try {
            const data = await pollRatesJob(taluka, village, gen, lang, page);
            if (!data || gen !== ratesFetchGeneration) return;
            renderResults(data, lang);
            setStatus(t("asrSuccess", lang), false);
            $("#asr-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (err) {
            if (gen !== ratesFetchGeneration) return;
            setStatus(formatApiError(err, lang, "asrError"), true);
        } finally {
            if (gen === ratesFetchGeneration && btn) btn.disabled = false;
        }
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

        // Click delegation on the results container
        const resultsContainer = $("#asr-results");
        if (resultsContainer) {
            resultsContainer.addEventListener("click", async (e) => {
                const pageLink = e.target.closest(".asr-page-link");
                if (pageLink && lastAsrResult) {
                    const page = parseInt(pageLink.dataset.page, 10);
                    if (page && page !== (lastAsrResult.pagination && lastAsrResult.pagination.currentPage)) {
                        loadRatesPage(page);
                    }
                    return;
                }

                // Survey section chip (portal-level survey dropdown switch)
                const chip = e.target.closest(".asr-survey-chip");
                if (chip && lastAsrResult) {
                    const surveyNo = chip.dataset.survey;
                    if (lastAsrResult.hasSurveyNumbers && lastAsrResult.surveyData && lastAsrResult.surveyData[surveyNo]) {
                        lastAsrResult.entries = lastAsrResult.surveyData[surveyNo];
                        lastAsrResult.selectedSurvey = surveyNo;
                        if (lastAsrResult.paginationByKey && lastAsrResult.paginationByKey[surveyNo]) {
                            lastAsrResult.pagination = lastAsrResult.paginationByKey[surveyNo];
                        }
                        renderResults(lastAsrResult, getLang());
                    }
                    return;
                }

                // Per-row SurveyNo button (fetch survey parcel numbers)
                const surveyBtn = e.target.closest(".asr-survey-row-btn");
                if (surveyBtn && lastAsrResult) {
                    const rowIdx = parseInt(surveyBtn.dataset.row, 10);
                    const expandRow = resultsContainer.querySelector(`[data-expand-row="${rowIdx}"]`);
                    const expandContent = resultsContainer.querySelector(`#asr-survey-expand-${rowIdx}`);
                    if (!expandRow || !expandContent) return;

                    // Toggle if already loaded
                    if (expandRow.classList.contains("asr-survey-loaded")) {
                        expandRow.classList.toggle("hidden");
                        return;
                    }

                    expandRow.classList.remove("hidden");
                    const lang = getLang();
                    try {
                        const surveyParam = lastAsrResult.selectedSurvey
                            ? `&survey=${encodeURIComponent(lastAsrResult.selectedSurvey)}`
                            : "";
                        const pageParam = lastAsrResult.pagination && lastAsrResult.pagination.currentPage > 1
                            ? `&page=${lastAsrResult.pagination.currentPage}`
                            : "";
                        const data = await apiGet(
                            `/get-surveys?taluka=${encodeURIComponent(lastAsrResult.taluka)}&village=${encodeURIComponent(lastAsrResult.village)}&row=${rowIdx}${surveyParam}${pageParam}`,
                            90000
                        );
                        const text = data.surveys || t("asrNoSurveys", lang);
                        expandContent.innerHTML = `<span class="asr-survey-numbers">${text}</span>`;
                        expandRow.classList.add("asr-survey-loaded");
                    } catch (err) {
                        expandContent.innerHTML = `<span class="asr-error-text">${err.message || t("asrError", lang)}</span>`;
                    }
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

    // ─── Calculator-embedded eASR lookup ────────────────────────────────────────
    // Compact inline rate lookup inside the calculator form.
    // Uses calc-asr-* element IDs to avoid conflicts with the standalone section.

    let calcAsrResult = null;

    function calcSetStatus(msg, isError) {
        const el = document.querySelector("#calc-asr-status");
        if (!el) return;
        el.textContent = msg || "";
        el.classList.toggle("asr-error", !!isError);
    }

    function calcFillRate(rateValue, label) {
        const input = document.querySelector("#asr-rate");
        if (!input) return;
        input.value = rateValue;
        input.dispatchEvent(new Event("input"));
        const badge = document.querySelector("#calc-selected-rate-badge");
        if (badge) {
            badge.textContent = label ? `${t("calcAsrSelected", getLang())} ${label} (₹${Number(rateValue).toLocaleString("en-IN")})` : "";
        }
        // Scroll to calculation inputs
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        input.classList.add("calc-rate-filled");
        setTimeout(() => input.classList.remove("calc-rate-filled"), 1500);
    }

    function renderCalcResults(data, lang) {
        const container = document.querySelector("#calc-asr-results");
        if (!container) return;
        calcAsrResult = data;

        const rows = flattenEntries(data);
        if (!rows.length) {
            container.innerHTML = `<div class="calc-asr-inner"><p class="muted" style="padding:12px 14px">${t("asrNoData", lang)}</p></div>`;
            container.classList.remove("hidden");
            return;
        }

        const cols = detectColumns(rows);

        const rateTypes = [];
        if (cols.openLand)    rateTypes.push({ field: "openLand",    label: t("asrOpenLand", lang) });
        if (cols.residential) rateTypes.push({ field: "residential", label: t("asrResidential", lang) });
        if (cols.office)      rateTypes.push({ field: "office",      label: t("asrOffice", lang) });
        if (cols.shop)        rateTypes.push({ field: "shop",        label: t("asrShop", lang) });
        if (cols.industrial)  rateTypes.push({ field: "industrial",  label: t("asrIndustrial", lang) });

        // Total columns for survey expand row colspan
        const totalCols = 1 + rateTypes.length + (cols.unit ? 1 : 0) + (cols.hasSurvey ? 1 : 0);

        let html = `<div class="calc-asr-inner">`;

        // Location type chips (e.g. जिरायत जमिनी, बिनशेती झालेल्या जमिनी)
        if (data.hasSurveyNumbers && data.surveyNumbers && data.surveyNumbers.length) {
            const selected = data.selectedSurvey || data.surveyNumbers[0];
            html += `<div class="calc-asr-loc-bar">`;
            data.surveyNumbers.forEach((sn) => {
                const active = sn === selected ? " active" : "";
                html += `<button type="button" class="calc-asr-loc-chip${active}" data-survey="${sn}">${sn}</button>`;
            });
            html += `</div>`;
        }

        html += `<div class="calc-asr-table-scroll"><table class="calc-asr-mini-table">`;
        html += `<thead><tr><th class="calc-th-subzone">${t("asrSubzone", lang)}</th>`;
        rateTypes.forEach((rt) => html += `<th>${rt.label}</th>`);
        if (cols.unit)      html += `<th>${t("asrUnit", lang)}</th>`;
        if (cols.hasSurvey) html += `<th></th>`;
        html += `</tr></thead><tbody>`;

        rows.forEach((row, idx) => {
            html += `<tr>`;
            const subzoneLabel = row.zoneNo
                ? `<span class="asr-zone-no">${row.zoneNo}</span> ${row.subzone || "—"}`
                : (row.subzone || "—");
            html += `<td class="calc-asr-subzone">${subzoneLabel}</td>`;

            rateTypes.forEach((rt) => {
                const val = row[rt.field];
                if (val > 0) {
                    html += `<td><button type="button" class="calc-rate-chip" data-rate="${val}" data-label="${rt.label}" title="${rt.label}: ₹${Number(val).toLocaleString("en-IN")}">₹${Number(val).toLocaleString("en-IN")}</button></td>`;
                } else {
                    html += `<td class="calc-cell-na">—</td>`;
                }
            });

            if (cols.unit)      html += `<td class="calc-asr-unit">${row.unit || "—"}</td>`;
            if (cols.hasSurvey) html += `<td class="calc-survey-cell">${row.hasSurvey ? `<button type="button" class="calc-survey-btn" data-row="${idx}" title="${t("asrSurveyNumbers", lang)}">📋 ${t("asrSurveysBtn", lang)}</button>` : ""}</td>`;
            html += `</tr>`;

            // Hidden expand row for survey numbers
            if (row.hasSurvey) {
                html += `<tr class="calc-survey-expand hidden" data-expand="${idx}">
                    <td colspan="${totalCols}" class="calc-survey-expand-td">
                        <div id="calc-survey-content-${idx}" class="calc-survey-content">
                            <span class="calc-survey-loading">${t("asrLoadingSurveys", lang)}</span>
                        </div>
                    </td>
                </tr>`;
            }
        });

        html += `</tbody></table></div>`;
        html += renderPaginationBar(data.pagination, "calc-asr-pagination");
        html += `<p class="calc-asr-pick-hint">↑ ${t("calcAsrPickPrompt", lang)}</p>`;
        html += `</div>`;

        container.innerHTML = html;
        container.classList.remove("hidden");
    }

    async function loadCalcRatesPage(page) {
        const taluka  = document.querySelector("#calc-asr-taluka")?.value;
        const village = document.querySelector("#calc-asr-village")?.value;
        const btn     = document.querySelector("#calc-asr-fetch-btn");
        const lang    = getLang();

        if (!taluka || !village) return;

        calcSetStatus(t("asrLoading", lang), false);
        if (btn) btn.disabled = true;

        try {
            const pageParam = page > 1 ? `&page=${page}` : "";
            const data = await apiGet(
                `/get-rates?taluka=${encodeURIComponent(taluka)}&village=${encodeURIComponent(village)}${pageParam}`,
                90000
            );
            if (!data || !data.entries) throw new Error(t("asrNoData", lang));
            renderCalcResults(data, lang);
            calcSetStatus(t("asrSuccess", lang), false);
        } catch (err) {
            calcSetStatus(err.message || t("asrError", lang), true);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function fetchCalcRates() {
        const taluka  = document.querySelector("#calc-asr-taluka")?.value;
        const village = document.querySelector("#calc-asr-village")?.value;
        const btn     = document.querySelector("#calc-asr-fetch-btn");
        const lang    = getLang();

        if (!taluka || !village) {
            calcSetStatus(t("asrValidation", lang), true);
            return;
        }

        calcSetStatus(t("asrLoading", lang), false);
        if (btn) btn.disabled = true;
        const container = document.querySelector("#calc-asr-results");
        if (container) container.classList.add("hidden");

        try {
            const data = await apiGet(
                `/get-rates?taluka=${encodeURIComponent(taluka)}&village=${encodeURIComponent(village)}`,
                90000
            );
            if (!data || !data.entries) throw new Error(t("asrNoData", lang));
            renderCalcResults(data, lang);
            calcSetStatus(t("asrSuccess", lang), false);
        } catch (err) {
            calcSetStatus(err.message || t("asrError", lang), true);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function loadCalcVillages(talukaName) {
        const select = document.querySelector("#calc-asr-village");
        const lang   = getLang();
        if (!select) return;
        if (!talukaName) { setSelectLoading(select, t("asrSelectVillage", lang), true); return; }
        const prev = select.value;
        setSelectLoading(select, t("asrLoadingVillages", lang), true);
        try {
            const data = await apiGet(`/get-villages?taluka=${encodeURIComponent(talukaName)}`, 60000);
            fillSelect(select, data.villages || [], t("asrChooseVillage", lang), prev);
        } catch (_) {
            setSelectLoading(select, t("asrLoadVillagesFailed", lang), true);
        }
    }

    async function loadCalcTalukas() {
        const select = document.querySelector("#calc-asr-taluka");
        const lang   = getLang();
        if (!select) return;
        const prev = select.value;
        setSelectLoading(select, t("asrLoadingTalukas", lang), true);
        try {
            const data = await loadStaticLocations();
            const names = (data.talukas || []).map((i) => (typeof i === "string" ? i : i.name)).filter(Boolean);
            if (names.length) {
                fillSelect(select, names, t("asrSelectTaluka", lang), prev, true);
                if (select.value) await loadCalcVillages(select.value);
                return;
            }
        } catch (_) { /* fall through */ }
        try {
            const data = await apiGet("/get-talukas");
            fillSelect(select, data.talukas || [], t("asrSelectTaluka", lang), prev, true);
            if (select.value) await loadCalcVillages(select.value);
        } catch (_) {
            setSelectLoading(select, t("asrLoadTalukasFailed", lang), true);
        }
    }

    function initCalcAsr() {
        const talukaSelect  = document.querySelector("#calc-asr-taluka");
        const villageSelect = document.querySelector("#calc-asr-village");
        const fetchBtn      = document.querySelector("#calc-asr-fetch-btn");
        const container     = document.querySelector("#calc-asr-results");
        if (!talukaSelect || !fetchBtn) return;

        loadCalcTalukas();

        talukaSelect.addEventListener("change", (e) => {
            if (container) container.classList.add("hidden");
            calcSetStatus("", false);
            loadCalcVillages(e.target.value);
        });

        villageSelect?.addEventListener("change", () => {
            if (container) container.classList.add("hidden");
            calcSetStatus("", false);
        });

        fetchBtn.addEventListener("click", fetchCalcRates);

        // Single delegated listener for the results container
        if (container) {
            container.addEventListener("click", async (e) => {
                const pageLink = e.target.closest(".asr-page-link");
                if (pageLink && calcAsrResult) {
                    const page = parseInt(pageLink.dataset.page, 10);
                    if (page && page !== (calcAsrResult.pagination && calcAsrResult.pagination.currentPage)) {
                        loadCalcRatesPage(page);
                    }
                    return;
                }

                // Rate chip → fill input
                const rateChip = e.target.closest(".calc-rate-chip");
                if (rateChip) {
                    calcFillRate(rateChip.dataset.rate, rateChip.dataset.label);
                    container.querySelectorAll(".calc-rate-chip").forEach((c) => c.classList.remove("selected"));
                    rateChip.classList.add("selected");
                    return;
                }

                // Location type chip → switch survey section
                const locChip = e.target.closest(".calc-asr-loc-chip");
                if (locChip && calcAsrResult) {
                    const key = locChip.dataset.survey;
                    if (calcAsrResult.surveyData && calcAsrResult.surveyData[key]) {
                        calcAsrResult.entries = calcAsrResult.surveyData[key];
                        calcAsrResult.selectedSurvey = key;
                        if (calcAsrResult.paginationByKey && calcAsrResult.paginationByKey[key]) {
                            calcAsrResult.pagination = calcAsrResult.paginationByKey[key];
                        }
                        renderCalcResults(calcAsrResult, getLang());
                    }
                    return;
                }

                // Survey number button → fetch and show parcel numbers
                const surveyBtn = e.target.closest(".calc-survey-btn");
                if (surveyBtn && calcAsrResult) {
                    const rowIdx     = parseInt(surveyBtn.dataset.row, 10);
                    const expandRow  = container.querySelector(`[data-expand="${rowIdx}"]`);
                    const expandDiv  = container.querySelector(`#calc-survey-content-${rowIdx}`);
                    if (!expandRow || !expandDiv) return;

                    // Toggle if already loaded
                    if (expandRow.classList.contains("calc-survey-loaded")) {
                        expandRow.classList.toggle("hidden");
                        return;
                    }

                    expandRow.classList.remove("hidden");
                    const lang = getLang();
                    try {
                        const surveyParam = calcAsrResult.selectedSurvey
                            ? `&survey=${encodeURIComponent(calcAsrResult.selectedSurvey)}`
                            : "";
                        const pageParam = calcAsrResult.pagination && calcAsrResult.pagination.currentPage > 1
                            ? `&page=${calcAsrResult.pagination.currentPage}`
                            : "";
                        const data = await apiGet(
                            `/get-surveys?taluka=${encodeURIComponent(calcAsrResult.taluka)}&village=${encodeURIComponent(calcAsrResult.village)}&row=${rowIdx}${surveyParam}${pageParam}`,
                            90000
                        );
                        const text = data.surveys || t("asrNoSurveys", lang);
                        expandDiv.innerHTML = `<span class="calc-survey-nos">${text}</span>`;
                        expandRow.classList.add("calc-survey-loaded");
                    } catch (err) {
                        expandDiv.innerHTML = `<span class="asr-error-text">${err.message || t("asrError", lang)}</span>`;
                    }
                }
            });
        }
    }

    window.initCalcAsr = initCalcAsr;
})();
