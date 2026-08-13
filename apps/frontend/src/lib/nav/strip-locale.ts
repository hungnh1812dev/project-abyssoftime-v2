export function stripLocale(pathname: string, locale: string): string {
  const prefix = `/${locale}`;
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
}
