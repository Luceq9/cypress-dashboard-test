# Audyt strony – Cypress + dashboard

Zestaw automatycznych audytów (dostępność WCAG, testy wizualne, Lighthouse, SEO, bezpieczeństwo, RODO…)
uruchamianych na jednej lub wielu podstronach, z dashboardem do przeglądania wyników.

## Start

```bash
npm install
npm run dashboard        # http://localhost:4000 – uruchamianie testów i wyniki
```

Z terminala:

```bash
npm test                                                     # strona główna, wszystkie kategorie
npx cypress run --expose pageSource=crawl,maxPages=10        # 10 stron z linków strony głównej
npx cypress run --expose pageSource=sitemap,maxPages=20      # 20 stron z sitemap.xml
npx cypress run --config baseUrl=https://inna-strona.pl/     # inna domena
npx cypress run --spec cypress/e2e/02-a11y.cy.ts             # jedna kategoria
```

Własna lista adresów: zmienna `AUDIT_PAGES` (jeden adres w wierszu) + `AUDIT_PAGE_SOURCE=list`.

> W terminalu VS Code Cypress może nie wystartować (`bad option: --smoke-test`) – usuń zmienną
> `ELECTRON_RUN_AS_NODE` (`Remove-Item Env:ELECTRON_RUN_AS_NODE` w PowerShellu). Dashboard robi to sam.

## Kategorie

| Spec | Co sprawdza |
|---|---|
| `01-smoke` | status HTTP, nawigacja, H1, `<main>`, stopka |
| `02-a11y` | axe-core: WCAG 2.0–2.2 A/AA + dobre praktyki, desktop i mobile |
| `03-keyboard` | Tab: skip link, widoczny fokus, pułapki, `tabindex > 0` |
| `04-forms` | etykiety pól, nazwy przycisków, `autocomplete`, wpisywanie danych |
| `05-visual` | zrzut całej strony vs wzorzec (desktop/tablet/mobile) |
| `06-responsive` | reflow od 320 px, odstępy tekstu (WCAG 1.4.12), mały tekst |
| `07-performance` | LCP, CLS, FCP, TTFB, waga i liczba zasobów |
| `08-seo` | meta, nagłówki, canonical, Open Graph, JSON-LD, robots, sitemap |
| `09-links` | martwe linki i kotwice, nazwy linków, `target=_blank` |
| `10-security` | HTTPS, nagłówki, ciasteczka, mieszana treść, wystawione pliki |
| `11-console` | wyjątki JS, `console.error`, zasoby 4xx/5xx |
| `12-lighthouse` | Google Lighthouse (telefon + desktop), pełny raport HTML |
| `13-html` | walidacja HTML offline (html-validate) |
| `14-privacy` | ciasteczka i trackery przed zgodą, baner, polityka prywatności |
| `15-a11y-plus` | „ogranicz ruch”, autoodtwarzanie, tekst 200%, jakość alt, kody języka |

Każdy test zgłasza sprawdzenia ze statusem **błąd** (oblewa test) albo **ostrzeżenie** (tylko w raporcie).

## Testy wizualne

Pierwsze uruchomienie zapisuje wzorce w `cypress/visual/<domena>/baseline/`, kolejne porównują z nimi.
Zmianę zamierzoną zatwierdza się w dashboardzie przyciskiem „Zatwierdź jako nowy wzorzec”.
Mapy, iframe, wideo i karuzele są zamalowywane, elementy `fixed` (baner cookies) ukrywane.

## Pliki

- `cypress.config.ts` – wyznaczanie podstron, zapis wyników, porównywanie zrzutów, Lighthouse, walidacja HTML
- `cypress/support/audit.ts` – wspólne helpery (`report`, `check`, `forEachPage`)
- `scripts/lighthouse.mjs` – Lighthouse w osobnym procesie (wymaga Chrome)
- `dashboard/` – serwer (bez zależności) i strona dashboardu; wyniki w `dashboard/results.json`
