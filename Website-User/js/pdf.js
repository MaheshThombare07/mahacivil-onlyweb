/**
 * Generate PDF via browser print dialog (pure HTML/CSS/JS)
 */
function printReceipt(receiptHtml) {
    const printArea = document.getElementById("print-area");
    printArea.innerHTML = receiptHtml;
    window.print();
}

function buildReceiptHtml(result, lang) {
    const dt = formatDateTime();
    const isOpen = result.type === "open-plot";
    const title = isOpen ? t("openPlotCharges", lang) : t("builtUpCharges", lang);

    let summaryHtml = "";
    if (isOpen) {
        const authLabel = result.authority === "municipal"
            ? (lang === "mr" ? "महानगरपालिका" : "Municipal")
            : "CSMRD";
        summaryHtml = `
            <div class="summary-row"><span>${t("plotArea", lang)}</span><span>${formatArea(result.plotAreaSqM)} ${t("sqM", lang)}</span></div>
            <div class="summary-row"><span>${t("asrRate", lang)}</span><span>${formatRate(result.asrRate)}</span></div>
            <div class="summary-row"><span>${t("authorityLabel", lang)}</span><span><strong>${authLabel}</strong></span></div>
        `;
    } else {
        const s = result.summary;
        summaryHtml = `
            <div class="summary-row"><span>${t("plotArea", lang)}</span><span>${formatArea(s.plotAreaSqM)} ${t("sqM", lang)}</span></div>
            <div class="summary-row"><span>${t("asrRate", lang)}</span><span>${formatRate(s.asrRate)}</span></div>
            <div class="summary-row"><span>${t("builtUpRes", lang)}</span><span>${formatArea(s.builtUpResidential)} ${t("sqM", lang)}</span></div>
            <div class="summary-row"><span>${t("builtUpComm", lang)}</span><span>${formatArea(s.builtUpCommercial)} ${t("sqM", lang)}</span></div>
            <div class="summary-row"><span>${t("builtUpMargins", lang)}</span><span>${formatArea(s.builtUpInMargins)} ${t("sqM", lang)}</span></div>
            <div class="summary-row"><span>${t("maxBuiltUp", lang)}</span><span>${formatArea(s.maximumBuiltUpAllowed)} ${t("sqM", lang)}</span></div>
            <div class="summary-row"><span>${t("ancillaryConsumed", lang)}</span><span>${formatArea(s.ancillaryAreaConsumed)} ${t("sqM", lang)}</span></div>
            <div class="summary-row"><span>${t("regRes", lang)}</span><span>${formatArea(s.toBeRegularizedResidential)} ${t("sqM", lang)}</span></div>
            <div class="summary-row"><span>${t("regComm", lang)}</span><span>${formatArea(s.toBeRegularizedCommercial)} ${t("sqM", lang)}</span></div>
            <div class="summary-row"><span>${t("notReg", lang)}</span><span>${formatArea(s.notRegularizedArea)} ${t("sqM", lang)}</span></div>
        `;
    }

    let tableHead = isOpen
        ? `<th>${t("srNo", lang)}</th><th>${t("charges", lang)}</th><th>${t("rate", lang)}</th><th>${t("percentage", lang)}</th><th>${t("amount", lang)}</th>`
        : `<th>${t("charges", lang)}</th><th>${t("rate", lang)}</th><th>${t("percentage", lang)}</th><th>${t("amount", lang)}</th>`;

    let rows = result.charges.map(c => {
        const label = chargeLabel(c.name, lang);
        const rate = c.rate === "As per Ancillary" ? (lang === "mr" ? "अनुषंगिक नुसार" : "As per Ancillary") : c.rate;
        if (isOpen) {
            return `<tr><td>${c.serial}</td><td class="charge-name">${label}</td><td>${rate}</td><td>${c.pct}</td><td class="charge-amount">${formatCurrency(c.amount)}</td></tr>`;
        }
        return `<tr><td class="charge-name">${label}</td><td>${rate}</td><td>${c.pct || "-"}</td><td class="charge-amount">${formatCurrency(c.amount)}</td></tr>`;
    }).join("");

    const mobileCards = result.charges.map(c => {
        const label = chargeLabel(c.name, lang);
        const rate = c.rate === "As per Ancillary" ? (lang === "mr" ? "अनुषंगिक नुसार" : "As per Ancillary") : c.rate;
        const serial = isOpen ? `<span class="receipt-card-serial">${c.serial}</span>` : "";
        return `
            <div class="receipt-charge-card">
                ${serial}
                <div class="receipt-card-name">${label}</div>
                <div class="receipt-card-meta">
                    <span><em>${t("rate", lang)}:</em> ${rate}</span>
                    <span><em>${t("percentage", lang)}:</em> ${c.pct || "-"}</span>
                </div>
                <div class="receipt-card-amount">${formatCurrency(c.amount)}</div>
            </div>`;
    }).join("");

    const total = formatTotal(result.total);

    return `
        <div class="receipt">
            <div class="receipt-header">
                <div class="receipt-brand">MahaCivil</div>
                <h4>${title}</h4>
                <div class="receipt-date">${t("dateTime", lang)}: ${dt}</div>
            </div>
            <div class="receipt-body">
                <h5>${t("userInputSummary", lang)}</h5>
                ${summaryHtml}
                <h5 class="receipt-charges-heading">${title}</h5>
                <div class="receipt-charges-mobile">${mobileCards}</div>
                <div class="receipt-table-wrap">
                    <table class="charges-table receipt-charges-desktop">
                        <thead><tr>${tableHead}</tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <div class="receipt-total">
                    <span class="receipt-total-label">${t("total", lang)}</span>
                    <span class="receipt-total-value">${total}</span>
                </div>
            </div>
        </div>
    `;
}

function renderReceipt(result, lang) {
    return buildReceiptHtml(result, lang);
}

function flattenAsrRows(data) {
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

function buildAsrPdfHtml(data, lang) {
    const dt = formatDateTime();
    const district = lang === "mr" ? "छत्रपती संभाजीनगर" : "Chhatrapati Sambhajinagar";
    const rows = flattenAsrRows(data);
    const vibhagNo = rows.length ? rows[0].vibhagNo : null;
    const showUnit = rows.some((r) => r.unit && r.unit.trim());

    const tableRows = rows.map((row) => `
        <tr>
            <td style="padding:8px;border:1px solid #ccc;">${row.assessmentType}</td>
            <td style="padding:8px;border:1px solid #ccc;text-align:center;">${row.assessmentRange || "—"}</td>
            <td style="padding:8px;border:1px solid #ccc;text-align:center;font-weight:700;">${Number(row.rate)}</td>
            ${showUnit ? `<td style="padding:8px;border:1px solid #ccc;text-align:center;">${row.unit || "—"}</td>` : ""}
        </tr>
    `).join("");

    const unitHeader = showUnit ? `<th style="padding:10px;border:1px solid #5e157f;">${t("asrUnit", lang)}</th>` : "";

    return `
        <div style="font-family:sans-serif;max-width:800px;margin:0 auto;">
            <div style="background:#6a1b9a;color:#fff;text-align:center;padding:14px;font-weight:700;font-size:18px;">
                ${t("asrPortalTitle", lang)}
            </div>
            <div style="padding:16px 20px;background:#f5f5f5;border:1px solid #ddd;border-top:none;">
                <table style="width:100%;font-size:13px;border-collapse:collapse;">
                    <tr>
                        <td style="padding:6px 0;color:#666;font-weight:600;">${t("asrSelectedDistrict", lang)}</td>
                        <td style="padding:6px 0;font-weight:700;color:#002d5b;">${district}</td>
                    </tr>
                    <tr>
                        <td style="padding:6px 0;color:#666;font-weight:600;">${t("asrTaluka", lang)}</td>
                        <td style="padding:6px 0;font-weight:700;color:#002d5b;">${data.taluka}</td>
                    </tr>
                    <tr>
                        <td style="padding:6px 0;color:#666;font-weight:600;">${t("asrVillage", lang)}</td>
                        <td style="padding:6px 0;font-weight:700;color:#002d5b;">${data.village}</td>
                    </tr>
                    ${vibhagNo != null ? `
                    <tr>
                        <td style="padding:6px 0;color:#666;font-weight:600;">${t("asrVibhagNumber", lang)}</td>
                        <td style="padding:6px 0;font-weight:800;font-size:16px;color:#002d5b;">${vibhagNo}</td>
                    </tr>` : ""}
                    <tr>
                        <td style="padding:6px 0;color:#666;font-weight:600;">${t("dateTime", lang)}</td>
                        <td style="padding:6px 0;">${dt}</td>
                    </tr>
                </table>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:0;">
                <thead>
                    <tr style="background:#6a1b9a;color:#fff;">
                        <th style="padding:10px;border:1px solid #5e157f;text-align:left;">${t("asrAssessmentType", lang)}</th>
                        <th style="padding:10px;border:1px solid #5e157f;">${t("asrRange", lang)}</th>
                        <th style="padding:10px;border:1px solid #5e157f;">${t("asrRateCol", lang)}</th>
                        ${unitHeader}
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
            <div style="margin-top:12px;padding:10px 16px;font-size:11px;color:#666;border-top:1px solid #ddd;">
                <strong>MahaCivil</strong> · ${t("asrAllPagesNote", lang)} · ${rows.length} ${t("asrRowCount", lang)}
            </div>
        </div>
    `;
}

function printAsrRates(data, lang) {
    printReceipt(buildAsrPdfHtml(data, lang));
}
