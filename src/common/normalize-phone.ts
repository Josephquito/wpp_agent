/**
 * Normaliza cualquier formato de teléfono a "+<solo dígitos>".
 * Ejemplos:
 *   "593999130721"        -> "+593999130721"
 *   "+593999130721"       -> "+593999130721"
 *   "+593 99 913 0721"    -> "+593999130721"
 *   "593 99 913 0721"     -> "+593999130721"
 *   "593-99-913-0721"     -> "+593999130721"
 */
export function normalizePhone(raw: string): string {
  if (!raw) return '';
  const soloDigitos = raw.toString().replace(/[^0-9]/g, '');
  return `+${soloDigitos}`;
}
