import { check, describeEl, forEachPage, report } from '../support/audit'

const VAGUE_TEXT = /^(kliknij( tutaj)?|tutaj|więcej|czytaj więcej|zobacz|link|here|click here|more|read more)$/i

// Status każdego URL-a sprawdzamy raz na cały spec – podstrony mają w większości te same linki (menu, stopka)
const statusCache = new Map<string, number>()

describe('Linki', () => {
	forEachPage('linki wewnętrzne działają i mają zrozumiałe opisy', (page) => {
		const broken: string[] = []
		cy.visit(page)
		cy.location('origin').then((origin) => {
			cy.document().then((doc) => {
				const anchors = [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')]
				const internal = [...new Set(anchors.map((a) => a.href.split('#')[0]).filter((h) => h.startsWith(origin)))]
				// Kotwica "#sekcja" na tej samej stronie musi mieć element o takim id
				const brokenAnchors = anchors
					.map((a) => a.getAttribute('href') ?? '')
					.filter((h) => /^#[^#]+$/.test(h) && !doc.getElementById(decodeURIComponent(h.slice(1))))
				const external = anchors.filter((a) => /^https?:/.test(a.href) && !a.href.startsWith(origin))
				const unsafeBlank = anchors.filter((a) => a.target === '_blank' && !/noopener|noreferrer/.test(a.rel))
				const name = (a: HTMLAnchorElement) =>
					(a.getAttribute('aria-label') || a.textContent || a.querySelector('img')?.alt || a.title || '').trim().replace(/\s+/g, ' ')
				const empty = anchors.filter((a) => !name(a))
				const vague = anchors.filter((a) => VAGUE_TEXT.test(name(a)))
				const fakeLinks = anchors.filter((a) => /^(#|javascript:)/.test(a.getAttribute('href') ?? '') && a.getAttribute('href') !== '#main')

				internal.forEach((url) => {
					if (statusCache.has(url)) {
						if (statusCache.get(url)! >= 400) broken.push(`${statusCache.get(url)} ${url}`)
						return
					}
					cy.request({ url, failOnStatusCode: false, log: false }).then((res) => {
						statusCache.set(url, res.status)
						if (res.status >= 400) broken.push(`${res.status} ${url}`)
					})
				})

				cy.then(() =>
					report(
						'links',
						[
							check('Wewnętrzne linki odpowiadają (< 400)', broken.length === 0, {
								value: `${broken.length} z ${internal.length} niedziałających`,
								details: broken,
							}),
							check('Każdy link ma nazwę dostępną', empty.length === 0, {
								value: empty.length,
								details: empty.map((a) => a.getAttribute('href') ?? ''),
								ref: 'WCAG 2.4.4, 4.1.2',
							}),
							check('Brak niejasnych opisów („więcej”, „kliknij tutaj”)', vague.length === 0, {
								warnOnly: true,
								value: vague.length,
								details: vague.map(describeEl),
								ref: 'WCAG 2.4.4',
							}),
							check('target="_blank" z rel="noopener"', unsafeBlank.length === 0, {
								warnOnly: true,
								value: unsafeBlank.length,
								details: unsafeBlank.map((a) => a.href),
							}),
							check('Brak pseudo-linków (#, javascript:)', fakeLinks.length === 0, {
								warnOnly: true,
								value: fakeLinks.length,
								details: fakeLinks.map(describeEl),
							}),
							check('Kotwice (#id) prowadzą do istniejących elementów', brokenAnchors.length === 0, {
								warnOnly: true,
								value: brokenAnchors.length,
								details: brokenAnchors,
								ref: 'WCAG 2.4.1',
							}),
							check('Linki zewnętrzne', true, { value: external.length }),
						],
						{ broken, checked: internal.length }
					)
				)
			})
		})
	})
})
