# Finastic

A personal finance web application hosted on GitHub Pages with a Cloudflare Workers backend.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript, Recharts, PapaParse, pdf.js |
| Backend API | Cloudflare Worker (zero dependencies, Web Crypto API) |
| Storage | Cloudflare KV (transactions, income, auth) |
| Hosting | GitHub Pages (static frontend) |
| Auth | Password + TOTP 2FA (PBKDF2 + HMAC-SHA1) |

## Pages

1. **Login** (`/login`) — Password + TOTP two-factor auth. First-time setup creates credentials and scans a QR code.
2. **Enter Data** (`/data-entry`) — Upload Chase/credit-card CSV files, manually enter expenses, or upload/enter pay stubs (PDF or CSV) with auto-parsed tax deductions.
3. **Dashboard** (`/dashboard`) — Four analytics views: spending trends line graph, monthly expense table, income vs. expenditure comparison, and average monthly spend per category.

## One-time Setup

### 1. Cloudflare Worker

```bash
# Install Wrangler globally if you haven't
npm install -g wrangler
wrangler login

# Create the KV namespace
cd worker
npm install
wrangler kv namespace create FINANCE_KV
# Copy the printed `id` and `preview_id` into wrangler.toml

# Set the JWT secret (any long random string)
wrangler secret put JWT_SECRET

# Set your GitHub Pages origin to restrict CORS
wrangler secret put ALLOWED_ORIGIN   # e.g. https://omnesestuno.github.io

# Deploy
wrangler deploy
```

After deploying, note your Worker URL (e.g. `https://finastic-api.<your-subdomain>.workers.dev`).

### 2. GitHub Repository Secrets

In your GitHub repo → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `VITE_API_URL` | Your Worker URL (e.g. `https://finastic-api.xxx.workers.dev`) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Worker edit permissions |

### 3. GitHub Pages

In your repo → **Settings → Pages**, set the source to **GitHub Actions**.

### 4. Push to deploy

```bash
git push origin main
```

GitHub Actions will build the frontend and deploy it to Pages, and also redeploy the Worker.

## Local Development

```bash
# Frontend
cd frontend
npm install
VITE_API_URL=http://localhost:8787 npm run dev

# Worker (in a separate terminal)
cd worker
npm install
wrangler dev
```

## Expense Categories

| Category | Examples |
|---|---|
| **Costco** | Costco Warehouse, Instacart Costco, Costco.com |
| **Amazon** | Amazon.com, Amazon Marketplace, Kindle |
| **Groceries** | Lucky, H Mart, 99 Ranch, Fred Meyer, Safeway, QFC |
| **Dining & Takeout** | Restaurants, cafes, fast food, bars |
| **Gas** | Shell, Chevron, 7-Eleven gas |
| **Shopping** | Target, Old Navy, Nordstrom Rack, general retail |
| **Travel** | Airlines, hotels, JR East, Expedia, FastTrak, parking |
| **Entertainment** | Blizzard, Steam, Crunchyroll, Dogpatch Boulders |
| **Pet Care** | Nationwide Pet Insurance, vets, Bow Wow Meow, PetSmart |
| **Subscriptions & Utilities** | AT&T, Cloudflare, OpenAI, 1Password, NameCheap |
| **Automotive** | Car repair, O'Reilly Auto, EV charging (Electrify), KIA |
| **Health & Wellness** | Hims & Hers, gyms, pharmacies |
| **Personal Care** | Salons, barbershops |
| **Home & Garden** | Home Depot, IKEA |
| **Fees & Interest** | Credit card interest, late fees |
| **Taxes** | Auto-created from income tax deductions |
| **Other** | Everything else |

## CSV Format Support

The file uploader auto-detects these formats:

**Chase Credit Card Export**
```
Transaction Date,Post Date,Description,Category,Type,Amount,Memo
```

**Credit Card Statement (e.g. AMEX/BoA)**
```
Status,Date,Description,Debit,Credit,Member Name
```

Payments (credit card payoffs) are automatically skipped.

## Income & Tax Tracking

When you add an income entry with tax deductions, the taxes are automatically created as separate expense transactions in the **Taxes** category. This ensures:

- The spending trends graph (feature 4) **excludes** taxes (shows discretionary spending).
- The monthly expense table, income vs. expenditure view, and category averages **include** taxes for a complete picture.
