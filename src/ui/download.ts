/** Hand the viewer a text file (CSV, JSON) made in the page. */
export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One CSV line; fields with commas or quotes are quoted. */
export function csvRow(fields: ReadonlyArray<string | number>): string {
  return fields
    .map((f) => {
      const s = String(f);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}
