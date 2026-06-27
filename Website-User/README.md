# MahaCivil — User Website

Static website matching the MahaCivil Android app. Built with **HTML, CSS, and JavaScript only** (no frameworks).

## Features

- **Calculator** — Open Plot & Built-Up charges (same formulas as the app)
- **DP** — Chhatrapati Sambhajinagar sector maps (Google Earth Engine)
- **Contact** — Contact information page
- **Side drawer** — App Info, Contact Us, About Developer
- **English / Marathi** language toggle
- **PDF receipt** — via browser print dialog (Save as PDF)

## Run locally

Open `index.html` in a browser, or use a simple static server:

```bash
cd Website-User
python3 -m http.server 8080
```

Then visit: http://localhost:8080

## Folder structure

```
Website-User/
├── index.html
├── css/style.css
├── js/
│   ├── i18n.js        # Translations
│   ├── calculator.js  # Formulas & sectors
│   ├── pdf.js         # Receipt / print
│   └── app.js         # UI logic
└── README.md
```
