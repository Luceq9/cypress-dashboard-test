import { check, Check, describeEl, forEachPage, isVisible, report } from '../support/audit'

// 320 px = 400% powiększenia ekranu 1280 px (WCAG 1.4.10 Reflow)
const WIDTHS = [320, 375, 768, 1024, 1366]

// WCAG 1.4.12: treść musi znieść takie odstępy bez utraty informacji
const TEXT_SPACING_CSS =
	'*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}'

describe('Responsywność i czytelność', () => {
	forEachPage('brak poziomego przewijania, czytelny tekst i odporność na odstępy tekstu', (page) => {
		const checks: Check[] = []
		cy.visit(page)

		WIDTHS.forEach((w) => {
			cy.viewport(w, 800)
			cy.wait(300)
			cy.window().then((win) => {
				const doc = win.document
				const overflow = doc.documentElement.scrollWidth - win.innerWidth
				const offenders =
					overflow > 1
						? [...doc.body.querySelectorAll('*')]
								.filter((el) => isVisible(el) && el.getBoundingClientRect().right > win.innerWidth + 1)
								.filter((el, _, all) => !all.includes(el.parentElement!))
								.map(describeEl)
						: []
				checks.push(
					check(`${w}px – brak poziomego przewijania`, overflow <= 1, {
						value: overflow > 1 ? `wystaje ${overflow}px` : 'OK',
						details: offenders,
						ref: w === 320 ? 'WCAG 1.4.10' : undefined,
					})
				)
			})
		})

		cy.viewport(375, 812)
		cy.wait(300)
		cy.document().then((doc) => {
			const win = doc.defaultView!
			// Rozmiar celów dotykowych (WCAG 2.5.8) sprawdza dokładniej axe – reguła target-size w 02-a11y
			const tinyText = [...doc.body.querySelectorAll('p, li, a, span, td, label')].filter(
				(el) => isVisible(el) && el.textContent?.trim() && parseFloat(win.getComputedStyle(el).fontSize) < 12
			)
			checks.push(
				check('Tekst ≥ 12px (mobile)', tinyText.length === 0, { warnOnly: true, value: tinyText.length, details: tinyText.map(describeEl) })
			)
		})

		cy.viewport(1366, 768)
		cy.document().then((doc) => {
			const style = doc.createElement('style')
			style.textContent = TEXT_SPACING_CSS
			doc.head.appendChild(style)
		})
		cy.wait(300)
		cy.document().then((doc) => {
			const win = doc.defaultView!
			const clipped = [...doc.body.querySelectorAll('*')].filter((el) => {
				const cs = win.getComputedStyle(el)
				const hidesOverflow = [cs.overflow, cs.overflowX, cs.overflowY].some((o) => o === 'hidden' || o === 'clip')
				// Pomijamy treści tylko dla czytników (sr-only to celowe przycięcie) i osadzone mapy
				return (
					hidesOverflow &&
					isVisible(el) &&
					el.clientWidth > 2 &&
					el.clientHeight > 2 &&
					!el.closest('.gm-style, [id*=map]') &&
					el.textContent?.trim() &&
					(el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)
				)
			})
			checks.push(
				check('Tekst nie jest ucinany przy zwiększonych odstępach', clipped.length === 0, {
					warnOnly: true,
					value: clipped.length,
					details: clipped.map(describeEl),
					ref: 'WCAG 1.4.12',
				})
			)
			report('responsive', checks)
		})
	})
})
