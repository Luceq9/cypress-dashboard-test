import { check, Check, describeEl, forEachPage, PAGES, report } from '../support/audit'

interface HttpResult { status: number; body: string }

describe('SEO', () => {
	forEachPage('meta tagi, nagłówki, dane strukturalne, robots i sitemap', (page) => {
		const origin = new URL(Cypress.config('baseUrl')!).origin
		// robots.txt i sitemap dotyczą całej domeny – sprawdzamy je tylko przy pierwszej stronie
		const siteWide = page === PAGES[0]
		cy.visit(page)
		cy.document().then((doc) => {
			const meta = (sel: string) => doc.querySelector(sel)?.getAttribute('content')?.trim() ?? ''
			const title = doc.title.trim()
			const description = meta('meta[name="description"]')
			const robots = meta('meta[name="robots"]')
			const h1 = doc.querySelectorAll('h1').length

			// Pominięty poziom nagłówka, np. H2 -> H4
			const levels = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1]))
			const skipped = levels.flatMap((l, i) => (i > 0 && l > levels[i - 1] + 1 ? [`H${levels[i - 1]} → H${l}`] : []))

			const jsonLd = [...doc.querySelectorAll('script[type="application/ld+json"]')]
			const invalidJsonLd = jsonLd.filter((s) => {
				try {
					JSON.parse(s.textContent ?? '')
					return false
				} catch {
					return true
				}
			})
			const noAlt = [...doc.images].filter((i) => !i.hasAttribute('alt'))

			const site: Check[] = []
			if (siteWide) {
				cy.task<HttpResult>('httpCheck', { url: `${origin}/robots.txt` }).then((r) =>
					site.push(check('robots.txt', r.status === 200, { warnOnly: true, value: r.status }))
				)
				const found: string[] = []
				;['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'].forEach((p) =>
					cy.task<HttpResult>('httpCheck', { url: origin + p }).then((r) => {
						if (r.status === 200 && /<(urlset|sitemapindex)/.test(r.body)) found.push(p)
					})
				)
				cy.then(() => site.push(check('Mapa strony (sitemap)', found.length > 0, { warnOnly: true, value: found.join(', ') || 'nie znaleziono' })))
			}

			cy.then(() =>
				report(
					'seo',
					[
						check('Tytuł 10–60 znaków', title.length >= 10 && title.length <= 60, {
							warnOnly: title.length > 0,
							value: `${title.length} zn. – ${title}`,
						}),
						check('Meta description 50–160 znaków', description.length >= 50 && description.length <= 160, {
							warnOnly: description.length > 0,
							value: `${description.length} zn.`,
						}),
						check('Atrybut lang na <html>', !!doc.documentElement.lang, { value: doc.documentElement.lang, ref: 'WCAG 3.1.1' }),
						check('Meta viewport', !!doc.querySelector('meta[name="viewport"]')),
						check('Dokładnie jeden H1', h1 === 1, { warnOnly: h1 > 1, value: h1 }),
						check('Hierarchia nagłówków bez przeskoków', skipped.length === 0, { warnOnly: true, details: skipped, ref: 'WCAG 1.3.1' }),
						check('Link canonical', !!doc.querySelector('link[rel="canonical"]'), { warnOnly: true }),
						check('Strona indeksowalna (brak noindex)', !/noindex/i.test(robots), {
							warnOnly: true,
							value: robots || 'brak meta robots',
						}),
						check('Open Graph (og:title, og:description, og:image)', ['og:title', 'og:description', 'og:image'].every((p) => meta(`meta[property="${p}"]`)), {
							warnOnly: true,
							details: ['og:title', 'og:description', 'og:image'].filter((p) => !meta(`meta[property="${p}"]`)).map((p) => `brak ${p}`),
						}),
						check('Dane strukturalne JSON-LD', jsonLd.length > 0, { warnOnly: true, value: jsonLd.length }),
						check('JSON-LD jest poprawnym JSON-em', invalidJsonLd.length === 0, { value: invalidJsonLd.length }),
						check('Obrazki mają atrybut alt', noAlt.length === 0, { value: noAlt.length, details: noAlt.map(describeEl), ref: 'WCAG 1.1.1' }),
						check('Favicon', !!doc.querySelector('link[rel~="icon"]'), { warnOnly: true }),
						...site,
					],
					// Dashboard porównuje tytuły i opisy między podstronami (duplikaty)
					{ title, description, canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null }
				)
			)
		})
	})
})
