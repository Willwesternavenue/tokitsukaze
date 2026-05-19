export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  if (!tpl) return "";
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => {
    return vars[k] != null ? String(vars[k]) : "";
  });
}
