import * as pdfjsLib from 'pdfjs-dist';
import { TaxBreakdown } from '../types';

// Worker is configured in main.tsx
export interface ExtractedPaystub {
  grossPay: number | null;
  netPay: number | null;
  taxes: TaxBreakdown;
  description: string;
  confidence: 'high' | 'low';
  rawText: string;
}

function extractNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const raw = match[1].replace(/[$,\s]/g, '');
      const num = parseFloat(raw);
      if (!isNaN(num) && num > 0) return num;
    }
  }
  return null;
}

export async function parsePDFPaystub(file: File): Promise<ExtractedPaystub> {
  let rawText = '';

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const pageTexts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .filter((item) => 'str' in item)
        .map((item) => (item as { str: string }).str)
        .join(' ');
      pageTexts.push(pageText);
    }
    rawText = pageTexts.join('\n');
  } catch {
    return {
      grossPay: null,
      netPay: null,
      taxes: { federal: 0, state: 0, socialSecurity: 0, medicare: 0, other: 0 },
      description: 'Pay Stub',
      confidence: 'low',
      rawText: '',
    };
  }

  const text = rawText;

  const grossPay = extractNumber(text, [
    /gross\s+(?:pay|earnings|wages)[^\d]*?([\d,]+\.?\d*)/i,
    /total\s+(?:gross|earnings)[^\d]*?([\d,]+\.?\d*)/i,
    /gross\s+compensation[^\d]*?([\d,]+\.?\d*)/i,
    /current\s+gross[^\d]*?([\d,]+\.?\d*)/i,
  ]);

  const netPay = extractNumber(text, [
    /net\s+pay[^\d]*?([\d,]+\.?\d*)/i,
    /net\s+(?:earnings|wages)[^\d]*?([\d,]+\.?\d*)/i,
    /total\s+net[^\d]*?([\d,]+\.?\d*)/i,
    /take.?home[^\d]*?([\d,]+\.?\d*)/i,
  ]);

  const federal = extractNumber(text, [
    /federal\s+(?:income\s+)?tax[^\d]*?([\d,]+\.?\d*)/i,
    /fed\s+(?:income\s+)?tax[^\d]*?([\d,]+\.?\d*)/i,
    /federal\s+withholding[^\d]*?([\d,]+\.?\d*)/i,
  ]);

  const state = extractNumber(text, [
    /state\s+(?:income\s+)?tax[^\d]*?([\d,]+\.?\d*)/i,
    /state\s+withholding[^\d]*?([\d,]+\.?\d*)/i,
    /ca\s+(?:sdi|pfl|pit)[^\d]*?([\d,]+\.?\d*)/i,
  ]);

  const socialSecurity = extractNumber(text, [
    /social\s+security\s+(?:tax|ee)[^\d]*?([\d,]+\.?\d*)/i,
    /oasdi[^\d]*?([\d,]+\.?\d*)/i,
    /ss\s+tax[^\d]*?([\d,]+\.?\d*)/i,
    /fica\s+(?:ss|social)[^\d]*?([\d,]+\.?\d*)/i,
  ]);

  const medicare = extractNumber(text, [
    /medicare\s+(?:tax|ee)?[^\d]*?([\d,]+\.?\d*)/i,
    /med\s+(?:tax|ee)[^\d]*?([\d,]+\.?\d*)/i,
    /fica\s+med[^\d]*?([\d,]+\.?\d*)/i,
  ]);

  const hasEnoughData = grossPay !== null || netPay !== null;
  const confidence: 'high' | 'low' = grossPay !== null && netPay !== null ? 'high' : 'low';

  // Derive missing value if possible
  const taxTotal = (federal ?? 0) + (state ?? 0) + (socialSecurity ?? 0) + (medicare ?? 0);
  let derivedNet = netPay;
  let derivedGross = grossPay;

  if (grossPay !== null && netPay === null && taxTotal > 0) {
    derivedNet = grossPay - taxTotal;
  } else if (netPay !== null && grossPay === null && taxTotal > 0) {
    derivedGross = netPay + taxTotal;
  }

  if (!hasEnoughData) {
    // Return empty result — user will fill manually
    return {
      grossPay: null,
      netPay: null,
      taxes: { federal: 0, state: 0, socialSecurity: 0, medicare: 0, other: 0 },
      description: file.name.replace(/\.[^.]+$/, ''),
      confidence: 'low',
      rawText,
    };
  }

  return {
    grossPay: derivedGross,
    netPay: derivedNet,
    taxes: {
      federal: federal ?? 0,
      state: state ?? 0,
      socialSecurity: socialSecurity ?? 0,
      medicare: medicare ?? 0,
      other: 0,
    },
    description: file.name.replace(/\.[^.]+$/, ''),
    confidence,
    rawText,
  };
}

export async function extractIncomeFromCSVText(text: string): Promise<ExtractedPaystub> {
  const grossPay = extractNumber(text, [
    /gross[^\d]*([\d,]+\.?\d*)/i,
    /total\s+earnings[^\d]*([\d,]+\.?\d*)/i,
  ]);
  const netPay = extractNumber(text, [
    /net[^\d]*([\d,]+\.?\d*)/i,
    /take.?home[^\d]*([\d,]+\.?\d*)/i,
  ]);
  const federal = extractNumber(text, [/federal[^\d]*([\d,]+\.?\d*)/i]);
  const state = extractNumber(text, [/state[^\d]*([\d,]+\.?\d*)/i]);
  const socialSecurity = extractNumber(text, [/social\s*security|oasdi/i]) ? extractNumber(text, [/social\s*security[^\d]*([\d,]+\.?\d*)/i, /oasdi[^\d]*([\d,]+\.?\d*)/i]) : null;
  const medicare = extractNumber(text, [/medicare[^\d]*([\d,]+\.?\d*)/i]);

  return {
    grossPay,
    netPay,
    taxes: {
      federal: federal ?? 0,
      state: state ?? 0,
      socialSecurity: socialSecurity ?? 0,
      medicare: medicare ?? 0,
      other: 0,
    },
    description: 'Pay Stub',
    confidence: grossPay !== null ? 'high' : 'low',
    rawText: text,
  };
}
