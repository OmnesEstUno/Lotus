import { Category, CategoryMapping } from '../../types';

// ─── Merchant Rules ──────────────────────────────────────────────────────────
// Order matters — first match wins. More specific rules go first.
// Always use word boundaries (\b) to avoid substring false positives like
// "mobil" matching inside "T-Mobile".

const MERCHANT_RULES: Array<{ pattern: RegExp; category: Category }> = [
  // ─── Costco (before Amazon, because "costco by instacart" could match) ──
  { pattern: /\bcostco\b/i, category: 'Costco' },

  // ─── Amazon Web Services (must come before the general Amazon rule) ────
  { pattern: /\bamazon\s+web\s+services\b|\baws\b/i, category: 'Subscriptions & Utilities' },

  // ─── Amazon retail / Kindle ────────────────────────────────────────────
  { pattern: /\bamazon\b|\bkindle\b|\bamzn\b/i, category: 'Amazon' },

  // ─── Telecom / Wireless carriers ──────────────────────────────────────
  // T-Mobile must be here, NOT the Gas rule. Explicit carriers only.
  {
    pattern: /\bt[-.\s]?mobile\b|\bverizon\s+wireless\b|\bsprint\b|\bmetro\s*pcs\b|\bmetropcs\b|\bcricket\s+wireless\b|\bmint\s+mobile\b|\bgoogle\s+fi\b|\bus\s+cellular\b|\bboost\s+mobile\b|\bstraight\s+talk\b|\btracfone\b|\bconsumer\s+cellular\b|\bxfinity\s+mobile\b/i,
    category: 'Subscriptions & Utilities',
  },

  // ─── Internet / cable / streaming ──────────────────────────────────────
  {
    pattern: /\bcomcast\b|\bxfinity\b|\bspectrum\b|\bcharter\s+comm\b|\btime\s+warner\b|\bcenturylink\b|\bat\s*&\s*t\b|\bat&amp;t\b|\bfrontier\s+comm\b|\bdirectv\b|\bdish\s+network\b/i,
    category: 'Subscriptions & Utilities',
  },
  {
    pattern: /\bnetflix\b|\bhulu\b|\bdisney\s*\+|\bdisney\s+plus\b|\bhbo(\s*max)?\b|\bpeacock\b|\bparamount\s*\+?\b|\bapple\s+tv\b|\bcrunchyroll\b|\byoutube\s*(premium|tv)\b|\bspotify\b|\bpandora\b/i,
    category: 'Subscriptions & Utilities',
  },

  // ─── Household utilities (power, water, gas utility, waste) ───────────
  {
    pattern: /\bpg\s*&\s*e\b|\bpge\b|\bsdg\s*&\s*e\b|\bsocal\s+edison\b|\bcon\s+edison\b|\bduke\s+energy\b|\bdominion\s+energy\b|\bnational\s+grid\b|\bwaste\s+management\b|\brepublic\s+services\b|\bwater\s+(district|company)\b|\bmunicipal\s+util\b|\bcity\s+of\s+\w+\s+util\b|\bsewer\b|\bgarbage\s+collection\b/i,
    category: 'Subscriptions & Utilities',
  },

  // ─── Pet care ─────────────────────────────────────────────────────────
  { pattern: /\bnationwide\s+pet\b/i, category: 'Pet Care' },
  {
    pattern: /\bbow\s+wow\s+meow\b|\bpet\s+food\s+express\b|\bmid-peninsula\s+animal\b|\bpetsmart\b|\bpetco\b|\banimal\s+(hospital|clinic)\b|\bveterinar\w*|\bpet\s+(food|store|supply|supplies)\b/i,
    category: 'Pet Care',
  },

  // ─── Entertainment ─────────────────────────────────────────────────────
  {
    pattern: /\bblizzard\b|\bsteamgames\b|\bsteam\s+purchase\b|\bwl\s*\*\s*steam\b|\bdogpatch\s+boulders\b|\bintergem\b|\bnintendo\b|\bplaystation\b|\bxbox\s*(live|store)?\b|\bepic\s+games\b|\broblox\b|\btwitch\b|\bpatreon\b/i,
    category: 'Entertainment',
  },

  // ─── Other subscriptions ──────────────────────────────────────────────
  {
    pattern: /\bcloudflare\b|\bopenai\b|\bchatgpt\b|\b1password\b|\bnamecheap\b|\bairalo\b|\bpaypal\s*\*\s*airalo\b|\bgithub\b|\bfigma\b|\bnotion\b|\blinear\s+app\b|\bdropbox\b|\bgoogle\s+(one|storage|workspace)\b|\bicloud\b|\badobe\b|\bmicrosoft\s+(365|office)\b/i,
    category: 'Subscriptions & Utilities',
  },

  // ─── Gas stations (strict — word boundaries to avoid "T-Mobile" collisions) ──
  {
    pattern: /\bshell\s+oil\b|\bshell\s*#|\bchevron\b|\bexxon\b|\bmobil\b(?!e)|\barco\b|\bconoco\b|\bvalero\b|\bsunoco\b|\btexaco\b|\bphillips\s+66\b|\b76\s+(gas|station|fuel)\b|\bcircle\s*k\b|\b7-eleven\s*#?\s*\d/i,
    category: 'Gas',
  },

  // ─── Grocery stores ────────────────────────────────────────────────────
  {
    pattern: /\blucky\s*#\d|\blucky\s+supermarket\b|\bh\s*mart\b|\b99\s*ranch\b|\bfred[-.\s]?meyer\b|\bosaka\s+marketplace\b|\bmega\s*mart\b|\bqfc\s*#?\d|\bralphs\b|\bsafeway\b|\btrader\s+joe\b|\bwhole\s+foods\b|\bkroger\b|\balbertsons\b|\baldi\b|\bnijiya\b|\bholly\s+market\b|\bmason\s+street\s+deli\b|\bcrossroad\s+specialty\b|\bwal-mart\s+grocery\b|\bwalmart\s+grocery\b|\bpublix\b|\bwegmans\b|\bharris\s+teeter\b|\bstop\s*&\s*shop\b|\bfood\s+lion\b|\bwinco\s+foods\b|\bsprouts\b|\bhe-b\b|\bsmith's\s+food\b/i,
    category: 'Groceries',
  },
  { pattern: /\blawson\b|\bfamilymart\b/i, category: 'Groceries' },

  // ─── Dining chains (before general Food & Drink) ───────────────────────
  {
    pattern: /\bjack\s+in\s+the\s+box\b|\bmcdonald|\bburger\s+king\b|\bwendy's\b|\bpopeyes\b|\bin-n-out\b|\btaco\s+bell\b|\bsubway\b|\bchipotle\b|\bchick-fil-a\b|\bkfc\b|\bdunkin\b|\bstarbucks\b|\bpanera\b|\bfive\s+guys\b|\bshake\s+shack\b|\bpanda\s+express\b|\blittle\s+caesar\b|\bpizza\s+hut\b|\bdomino'?s\b|\bpapa\s+john\b|\bbaskin\b|\bpopeye\b/i,
    category: 'Dining & Takeout',
  },

  // ─── Travel — airlines ────────────────────────────────────────────────
  {
    pattern: /\balaska\s+air\b|\bunited\s+\d|\bdelta\s+air\b|\bsouthwest\s+air\b|\bjetblue\b|\bamerican\s+airlines\b|\bspirit\s+airlines\b|\bfrontier\s+airlines\b|\blufthansa\b|\bana\s+airways\b|\bkoean\s+air\b/i,
    category: 'Travel',
  },

  // ─── Travel — hotels, booking sites ────────────────────────────────────
  {
    pattern: /\bexpedia\b|\bhotels\.com\b|\bmarriott\b|\bhilton\b|\bhyatt\b|\bairbnb\b|\bvrbo\b|\btoyoko\s+inn\b|\bapa\s+hotel\b|\bresidence\s+inn\b|\bbest\s+western\b|\bholiday\s+inn\b|\bsheraton\b|\bwestin\b|\bmotel\s*6\b|\bsolaniwa\b|\bmiraito\b/i,
    category: 'Travel',
  },

  // ─── Travel — transit, rideshare, tolls, parking ──────────────────────
  { pattern: /\bfastrak\b|\bmta\s+meter\b|\bjr\s+east\b|\bkeisei\b|\bamtrak\b/i, category: 'Travel' },
  { pattern: /\buber\s*(eats)?\b|\blyft\b/i, category: 'Travel' },
  { pattern: /\bparking\b|\blaz\s+parking\b|\bpaybyphone\s+parking\b/i, category: 'Travel' },
  { pattern: /\bpaypal\s*\*\s*expedia\b/i, category: 'Travel' },

  // ─── Automotive ────────────────────────────────────────────────────────
  {
    pattern: /\btrans\s+auto\s+repair\b|\bo'reilly\b|\badvance\s+auto\b|\bautozone\b|\bjiffy\s+lube\b|\bmidas\b|\bpep\s+boys\b|\bkia\s+(america|motors?\s+finance)\b|\bkmf\b|\bkmfusa\b/i,
    category: 'Automotive',
  },
  {
    pattern: /\bstevens\s+creek\s+kia\b|\bford\s+motor\s+credit\b|\btoyota\s+financial\b|\bhonda\s+financial\b|\bhyundai\s+(motor|financial)\b|\bnissan\s+motor\s+accep\b|\bvw\s+credit\b|\bbmw\s+financial\b|\bmercedes.*financial\b/i,
    category: 'Automotive',
  },
  { pattern: /\bauto\s+pride\b|\bcar\s+wash\b|\bdmv\b|\bsmog\s+check\b|\btire\s+(shop|pros)\b/i, category: 'Automotive' },
  { pattern: /\belectrify\s+america\b|\bevgo\b|\bchargepoint\b|\bblink\s+charging\b/i, category: 'Automotive' },
  { pattern: /\bnyx\s*\*\s*\d*electrify\b/i, category: 'Automotive' },

  // ─── Health & wellness ────────────────────────────────────────────────
  {
    pattern: /\bhims\b|\bhers\s+health\b|\bwellnessmart\b|\bcvs\s*(pharmacy|health)\b|\bwalgreens\b|\brite\s+aid\b|\burgent\s+care\b|\bkaiser\s+permanente\b|\bquest\s+diagnostics\b|\blabcorp\b|\bone\s+medical\b|\banthem\s+blue\b|\bblue\s+cross\b|\bblue\s+shield\b|\bunited\s*healthcare\b|\bcigna\b|\baetna\b|\bhumana\b|\bgoodrx\b/i,
    category: 'Health & Wellness',
  },

  // ─── Personal care ────────────────────────────────────────────────────
  {
    pattern: /\bcurl\s+dynasty\b|\bgreat\s+clips\b|\bsupercuts\b|\bfantastic\s+sams\b|\bhair\s+salon\b|\bnail\s+salon\b|\bmassage\s+envy\b|\bbarber(shop)?\b|\bspa\b/i,
    category: 'Personal Care',
  },

  // ─── Home & garden ────────────────────────────────────────────────────
  { pattern: /\bhome\s+depot\b|\blowe's\b|\blowes\s+home\b|\bikea\b|\bace\s+hardware\b|\btrue\s+value\b/i, category: 'Home & Garden' },

  // ─── Fees & interest ──────────────────────────────────────────────────
  { pattern: /\binterest\s+charged\b|\blate\s+fee\b|\bannual\s+fee\b|\boverdraft\b|\batm\s+fee\b|\bwire\s+fee\b|\bfinance\s+charge\b/i, category: 'Fees & Interest' },
];

// ─── CSV "category" column → our Category ────────────────────────────────────
// Works across banks — normalized to lowercase/trimmed.
const CSV_CATEGORY_MAP: Record<string, Category> = {
  // Chase
  'shopping': 'Shopping',
  'food & drink': 'Dining & Takeout',
  'groceries': 'Groceries',
  'bills & utilities': 'Subscriptions & Utilities',
  'entertainment': 'Entertainment',
  'travel': 'Travel',
  'automotive': 'Automotive',
  'gas': 'Gas',
  'gas & fuel': 'Gas',
  'health & wellness': 'Health & Wellness',
  'personal': 'Personal Care',
  'personal care': 'Personal Care',
  'home': 'Home & Garden',
  'home improvement': 'Home & Garden',
  'professional services': 'Other',
  'fees & adjustments': 'Fees & Interest',
  'fees': 'Fees & Interest',

  // Common bank/checking category labels
  'mobile phone': 'Subscriptions & Utilities',
  'telephone': 'Subscriptions & Utilities',
  'phone': 'Subscriptions & Utilities',
  'internet': 'Subscriptions & Utilities',
  'cable': 'Subscriptions & Utilities',
  'television': 'Subscriptions & Utilities',
  'utilities': 'Subscriptions & Utilities',
  'electric': 'Subscriptions & Utilities',
  'gas & electric': 'Subscriptions & Utilities',
  'water': 'Subscriptions & Utilities',
  'insurance': 'Subscriptions & Utilities',
  'auto insurance': 'Subscriptions & Utilities',
  'health insurance': 'Subscriptions & Utilities',

  'auto payment': 'Automotive',
  'auto & transport': 'Automotive',
  'car payment': 'Automotive',
  'auto service': 'Automotive',
  'service & parts': 'Automotive',

  'restaurants': 'Dining & Takeout',
  'fast food': 'Dining & Takeout',
  'coffee shops': 'Dining & Takeout',

  'rent': 'Home & Garden',
  'mortgage & rent': 'Home & Garden',
  'mortgage': 'Home & Garden',
  'household': 'Home & Garden',

  'doctor': 'Health & Wellness',
  'pharmacy': 'Health & Wellness',
  'healthcare': 'Health & Wellness',
  'dentist': 'Health & Wellness',

  'pets': 'Pet Care',
  'pet food & supplies': 'Pet Care',
  'veterinary': 'Pet Care',
  'pet services': 'Pet Care',
};

// ─── Public API ─────────────────────────────────────────────────────────────

export function categorize(description: string, csvCategory?: string): Category {
  const desc = description.replace(/&amp;/g, '&');

  // 1. Merchant rules — most specific, highest signal
  for (const rule of MERCHANT_RULES) {
    if (rule.pattern.test(desc)) return rule.category;
  }

  // 2. CSV-provided category (if present) mapped to our taxonomy
  if (csvCategory) {
    const normalized = csvCategory.trim().toLowerCase();
    if (CSV_CATEGORY_MAP[normalized]) return CSV_CATEGORY_MAP[normalized];
  }

  // 3. Unknown
  return 'Other';
}

// ─── User Mappings ──────────────────────────────────────────────────────────

/**
 * Derive a matching pattern from a transaction description for use in
 * user-defined mappings. Takes the prefix up to the first digit, asterisk, or
 * hash character (which typically marks a per-transaction unique ID), and
 * caps at 40 characters.
 *
 * Examples:
 *   "AMAZON MKTPL*BC50G3AR0"     → "AMAZON MKTPL"
 *   "LUCKY #745 REDWOOD"         → "LUCKY"
 *   "T-MOBILE PCS SVC ****7265"  → "T-MOBILE PCS SVC"
 */
export function derivePattern(description: string): string {
  const match = description.match(/^[^0-9*#]+/);
  const prefix = (match ? match[0] : description).trim();
  return prefix.slice(0, 40).trim();
}

/**
 * Check user-defined mappings for a description match. Returns the associated
 * category or null if no mapping applies. Uses case-insensitive substring
 * matching.
 */
export function applyUserMappings(
  description: string,
  mappings: CategoryMapping[] | undefined,
): Category | null {
  if (!mappings || mappings.length === 0) return null;
  const desc = description.toLowerCase();
  for (const m of mappings) {
    const pattern = m.pattern?.trim();
    if (!pattern) continue;
    if (desc.includes(pattern.toLowerCase())) return m.category;
  }
  return null;
}
