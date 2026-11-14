/** Enmascara un documento para mostrarlo: solo los últimos caracteres (diseño §3.0, datos personales). */
export function maskDocument(value: string): string {
  const clean = value.trim();
  if (clean.length === 0) return '';
  const visible = clean.length > 6 ? 4 : clean.length > 3 ? 2 : 0;
  return `${'•'.repeat(clean.length - visible)}${clean.slice(clean.length - visible)}`;
}
