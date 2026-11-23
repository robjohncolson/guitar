import { PRODUCT, TAGLINE } from '../brand';

export type Page = 'trainer' | 'piece';

/** The one site navigation for both pages: the product name, the two ways in (the current one marked), and the tagline. */
export function siteNav(current: Page): string {
  const base = import.meta.env.BASE_URL;
  const link = (page: Page, href: string, label: string) =>
    `<a href="${href}"${page === current ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="app-nav" aria-label="Site"><strong class="app-brand">${PRODUCT}</strong>${link('trainer', base, 'Guitar course')}${link('piece', `${base}piece.html`, 'Pieces · piano &amp; guitar')}<span>${TAGLINE}</span></nav>`;
}
