import { check, forEachPage, isVisible, report } from '../support/audit'

describe('Smoke', () => {
	forEachPage('strona odpowiada i renderuje kluczowe elementy', (page) => {
		cy.request({ url: page, failOnStatusCode: false }).then((res) => {
			cy.visit(page, { failOnStatusCode: false })
			cy.document().then((doc) => {
				const visible = (sel: string) => [...doc.querySelectorAll(sel)].some(isVisible)
				report('smoke', [
					check('Status HTTP', res.status === 200, { value: res.status }),
					check('Czas odpowiedzi serwera < 2 s', res.duration < 2000, { value: `${res.duration} ms`, warnOnly: true }),
					check('Tytuł strony', doc.title.trim() !== '', { value: doc.title.trim() }),
					check('Nawigacja <nav>', !!doc.querySelector('nav, [role=navigation]')),
					check('Widoczny nagłówek H1', visible('h1')),
					check('Obszar treści <main>', !!doc.querySelector('main, [role=main]'), { warnOnly: true, ref: 'WCAG 1.3.1' }),
					check('Stopka', !!doc.querySelector('footer, [role=contentinfo], [class*=footer]')),
					check('Logo', visible('img[class*=logo], [class*=logo] img, img[alt*=logo i]'), { warnOnly: true }),
				])
			})
		})
	})
})
