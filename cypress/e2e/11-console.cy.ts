import { check, report, forEachPage } from '../support/audit'

describe('Błędy strony', () => {
	forEachPage('brak błędów JS, błędów w konsoli i niedziałających zasobów', (page) => {
		const jsErrors: string[] = []
		const consoleErrors: string[] = []
		const consoleWarnings: string[] = []
		const failedRequests: string[] = []

		cy.on('uncaught:exception', (err) => {
			jsErrors.push(err.message)
			return false
		})
		cy.intercept({ url: /.*/ }, (req) => {
			req.on('response', (res) => {
				if (res.statusCode >= 400) failedRequests.push(`${res.statusCode} ${req.url}`)
			})
		})

		cy.visit(page, {
			onBeforeLoad(win) {
				const toText = (args: unknown[]) => args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ').slice(0, 300)
				cy.stub(win.console, 'error').callsFake((...args: unknown[]) => consoleErrors.push(toText(args)))
				cy.stub(win.console, 'warn').callsFake((...args: unknown[]) => consoleWarnings.push(toText(args)))
			},
		})
		cy.document().its('readyState').should('eq', 'complete')
		cy.wait(2000)

		cy.document().then((doc) => {
			const brokenImages = [...doc.images].filter((i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src)).map((i) => i.currentSrc || i.src)

			report('console', [
				check('Brak nieobsłużonych wyjątków JS', jsErrors.length === 0, { value: jsErrors.length, details: jsErrors }),
				check('Brak console.error', consoleErrors.length === 0, { value: consoleErrors.length, details: consoleErrors }),
				check('Brak console.warn', consoleWarnings.length === 0, { warnOnly: true, value: consoleWarnings.length, details: consoleWarnings }),
				check('Wszystkie zasoby się ładują (brak 4xx/5xx)', failedRequests.length === 0, { value: failedRequests.length, details: [...new Set(failedRequests)] }),
				check('Brak niedziałających obrazków', brokenImages.length === 0, { value: brokenImages.length, details: brokenImages }),
			])
		})
	})
})
