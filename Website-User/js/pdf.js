/**
 * Generate PDF via browser print dialog (exact calculation data, single page)
 */
function getPrintStyles() {
    return `
        @page { size: A4; margin: 12mm; }
        * { box-sizing: border-box; }
        html, body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #0f2f2c;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        .print-receipt {
            width: 100%;
            max-width: 180mm;
            margin: 0 auto;
        }
        .print-header {
            background: #0f5c52;
            color: #fff;
            padding: 12px 16px;
            border-radius: 6px 6px 0 0;
        }
        .print-brand {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            opacity: 0.9;
            color: #7edccf;
        }
        .print-header h1 {
            margin: 4px 0 0;
            font-size: 16px;
            font-weight: 800;
            line-height: 1.25;
        }
        .print-date {
            margin-top: 4px;
            font-size: 11px;
            opacity: 0.9;
        }
        .print-body {
            border: 1px solid #d5e3e0;
            border-top: none;
            border-radius: 0 0 6px 6px;
            padding: 12px 14px 14px;
        }
        .print-body h2 {
            margin: 0 0 8px;
            font-size: 12px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: #0f5c52;
        }
        .print-body h2 + h2,
        .print-charges-title {
            margin-top: 12px;
        }
        .summary-table,
        .charges-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
            margin: 0;
        }
        .summary-table td {
            padding: 4px 0;
            border-bottom: 1px solid #eef3f2;
            vertical-align: top;
        }
        .summary-table td:first-child {
            color: #5a736f;
            width: 48%;
        }
        .summary-table td:last-child {
            font-weight: 700;
            text-align: right;
            color: #0f2f2c;
        }
        .charges-table th,
        .charges-table td {
            border: 1px solid #d5e3e0;
            padding: 6px 7px;
            text-align: left;
        }
        .charges-table th {
            background: #e8f5f2;
            color: #0f5c52;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }
        .charges-table td:last-child,
        .charges-table th:last-child {
            text-align: right;
            white-space: nowrap;
            font-weight: 700;
        }
        .charges-table td:nth-child(1) {
            width: 34px;
            text-align: center;
        }
        .print-total {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 10px;
            padding: 10px 12px;
            background: #0f5c52;
            color: #fff;
            border-radius: 6px;
            font-weight: 800;
        }
        .print-total-label { font-size: 12px; }
        .print-total-value { font-size: 15px; }
        .print-footer {
            margin-top: 14px;
            padding-top: 10px;
            border-top: 1px solid #d5e3e0;
            font-size: 10px;
            color: #5a736f;
            text-align: center;
            line-height: 1.45;
        }
        .print-footer-firm {
            display: block;
            font-size: 12px;
            font-weight: 800;
            color: #0f5c52;
            margin-bottom: 2px;
        }
        .print-footer-phone {
            display: block;
            font-size: 11px;
            font-weight: 700;
            color: #0f2f2c;
        }
        @media print {
            html, body { height: auto !important; overflow: hidden !important; }
            .print-receipt { page-break-inside: avoid; break-inside: avoid; }
        }
    `;
}

function openPrintWindow(title, bodyHtml) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>${getPrintStyles()}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=820,height=900");
    if (!printWindow) {
        // Fallback if popup blocked: use on-page print area
        const printArea = document.getElementById("print-area");
        if (printArea) {
            printArea.innerHTML = bodyHtml;
            document.body.classList.add("printing-receipt");
            window.print();
            setTimeout(() => {
                document.body.classList.remove("printing-receipt");
                printArea.innerHTML = "";
            }, 500);
        }
        return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    const triggerPrint = () => {
        printWindow.focus();
        printWindow.print();
        setTimeout(() => {
            try { printWindow.close(); } catch (_) { /* ignore */ }
        }, 300);
    };

    if (printWindow.document.readyState === "complete") {
        setTimeout(triggerPrint, 80);
    } else {
        printWindow.onload = () => setTimeout(triggerPrint, 80);
    }
}

function printReceipt(receiptHtml) {
    // Screen receipt HTML may include mobile cards; openPrintWindow is used for calculator PDF.
    openPrintWindow("MahaCivil Receipt", receiptHtml);
}

function buildReceiptHtml(result, lang) {
    const dt = formatDateTime();
    const isOpen = result.type === "open-plot";
    const title = isOpen ? t("openPlotCharges", lang) : t("builtUpCharges", lang);

    let summaryHtml = "";
    if (isOpen) {
        const authLabel = result.authority === "cmrda"
            ? t("authorityCmrda", lang)
            : t("authorityCsmc", lang);
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

/** Compact 1-page PDF of the exact calculated result (used by Generate PDF). */
function buildPrintReceiptHtml(result, lang) {
    const dt = formatDateTime();
    const isOpen = result.type === "open-plot";
    const title = isOpen ? t("openPlotCharges", lang) : t("builtUpCharges", lang);

    let summaryRows = "";
    if (isOpen) {
        const authLabel = result.authority === "cmrda"
            ? t("authorityCmrda", lang)
            : t("authorityCsmc", lang);
        summaryRows = `
            <tr><td>${t("plotArea", lang)}</td><td>${formatArea(result.plotAreaSqM)} ${t("sqM", lang)}</td></tr>
            <tr><td>${t("asrRate", lang)}</td><td>${formatRate(result.asrRate)}</td></tr>
            <tr><td>${t("authorityLabel", lang)}</td><td>${authLabel}</td></tr>
        `;
    } else {
        const s = result.summary;
        summaryRows = `
            <tr><td>${t("plotArea", lang)}</td><td>${formatArea(s.plotAreaSqM)} ${t("sqM", lang)}</td></tr>
            <tr><td>${t("asrRate", lang)}</td><td>${formatRate(s.asrRate)}</td></tr>
            <tr><td>${t("builtUpRes", lang)}</td><td>${formatArea(s.builtUpResidential)} ${t("sqM", lang)}</td></tr>
            <tr><td>${t("builtUpComm", lang)}</td><td>${formatArea(s.builtUpCommercial)} ${t("sqM", lang)}</td></tr>
            <tr><td>${t("builtUpMargins", lang)}</td><td>${formatArea(s.builtUpInMargins)} ${t("sqM", lang)}</td></tr>
            <tr><td>${t("maxBuiltUp", lang)}</td><td>${formatArea(s.maximumBuiltUpAllowed)} ${t("sqM", lang)}</td></tr>
            <tr><td>${t("ancillaryConsumed", lang)}</td><td>${formatArea(s.ancillaryAreaConsumed)} ${t("sqM", lang)}</td></tr>
            <tr><td>${t("regRes", lang)}</td><td>${formatArea(s.toBeRegularizedResidential)} ${t("sqM", lang)}</td></tr>
            <tr><td>${t("regComm", lang)}</td><td>${formatArea(s.toBeRegularizedCommercial)} ${t("sqM", lang)}</td></tr>
            <tr><td>${t("notReg", lang)}</td><td>${formatArea(s.notRegularizedArea)} ${t("sqM", lang)}</td></tr>
        `;
    }

    const head = isOpen
        ? `<tr><th>${t("srNo", lang)}</th><th>${t("charges", lang)}</th><th>${t("rate", lang)}</th><th>${t("percentage", lang)}</th><th>${t("amount", lang)}</th></tr>`
        : `<tr><th>${t("charges", lang)}</th><th>${t("rate", lang)}</th><th>${t("percentage", lang)}</th><th>${t("amount", lang)}</th></tr>`;

    const rows = result.charges.map((c) => {
        const label = chargeLabel(c.name, lang);
        const rate = c.rate === "As per Ancillary"
            ? (lang === "mr" ? "अनुषंगिक नुसार" : "As per Ancillary")
            : c.rate;
        if (isOpen) {
            return `<tr>
                <td>${c.serial}</td>
                <td>${label}</td>
                <td>${rate}</td>
                <td>${c.pct}</td>
                <td>${formatCurrency(c.amount)}</td>
            </tr>`;
        }
        return `<tr>
            <td>${label}</td>
            <td>${rate}</td>
            <td>${c.pct || "-"}</td>
            <td>${formatCurrency(c.amount)}</td>
        </tr>`;
    }).join("");

    return `
        <div class="print-receipt">
            <div class="print-header">
                <div class="print-brand">MahaCivil</div>
                <h1>${title}</h1>
                <div class="print-date">${t("dateTime", lang)}: ${dt}</div>
            </div>
            <div class="print-body">
                <h2>${t("userInputSummary", lang)}</h2>
                <table class="summary-table">${summaryRows}</table>
                <h2 class="print-charges-title">${title}</h2>
                <table class="charges-table">
                    <thead>${head}</thead>
                    <tbody>${rows}</tbody>
                </table>
                <div class="print-total">
                    <span class="print-total-label">${t("total", lang)}</span>
                    <span class="print-total-value">${formatTotal(result.total)}</span>
                </div>
                <div class="print-footer">
                    <span class="print-footer-firm">Vaibhav Budhwant Associates</span>
                    <span class="print-footer-phone">+91 95790 22322</span>
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
            <td>${row.assessmentType}</td>
            <td style="text-align:center;">${row.assessmentRange || "—"}</td>
            <td style="text-align:center;font-weight:700;">${Number(row.rate)}</td>
            ${showUnit ? `<td style="text-align:center;">${row.unit || "—"}</td>` : ""}
        </tr>
    `).join("");

    const unitHeader = showUnit ? `<th>${t("asrUnit", lang)}</th>` : "";

    return `
        <div class="print-receipt">
            <div class="print-header">
                <div class="print-brand">MahaCivil</div>
                <h1>${t("asrPortalTitle", lang)}</h1>
                <div class="print-date">${t("dateTime", lang)}: ${dt}</div>
            </div>
            <div class="print-body">
                <h2>${t("userInputSummary", lang)}</h2>
                <table class="summary-table">
                    <tr><td>${t("asrSelectedDistrict", lang)}</td><td>${district}</td></tr>
                    <tr><td>${t("asrTaluka", lang)}</td><td>${data.taluka}</td></tr>
                    <tr><td>${t("asrVillage", lang)}</td><td>${data.village}</td></tr>
                    ${vibhagNo != null ? `<tr><td>${t("asrVibhagNumber", lang)}</td><td>${vibhagNo}</td></tr>` : ""}
                </table>
                <h2 class="print-charges-title">${t("asrPortalTitle", lang)}</h2>
                <table class="charges-table">
                    <thead>
                        <tr>
                            <th style="text-align:left;">${t("asrAssessmentType", lang)}</th>
                            <th>${t("asrRange", lang)}</th>
                            <th>${t("asrRateCol", lang)}</th>
                            ${unitHeader}
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
                <div class="print-footer">
                    <span class="print-footer-firm">Vaibhav Budhwant Associates</span>
                    <span class="print-footer-phone">+91 95790 22322</span>
                </div>
            </div>
        </div>
    `;
}

function printAsrRates(data, lang) {
    openPrintWindow(t("asrPortalTitle", lang), buildAsrPdfHtml(data, lang));
}
