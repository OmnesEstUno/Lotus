import Papa from 'papaparse';

// ─── Kept for pay stub CSV extraction in pdfParser.ts ──────────────────────

export async function parseIncomeCSV(file: File): Promise<{ text: string; error?: string }> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as string[][];
        const text = rows.map((r) => r.join('\t')).join('\n');
        resolve({ text });
      },
      error: (err) => {
        resolve({ text: '', error: `The file could not be read: ${err.message}.` });
      },
    });
  });
}
