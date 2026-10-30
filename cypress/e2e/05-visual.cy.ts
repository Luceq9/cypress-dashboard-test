import { check, forEachPage, pageSlug, report, stabilizePage, trackNetwork, VIEWPORTS, VISUAL_MASK, waitForNetworkIdle } from '../support/audit'

interface SnapshotResult {
	status: 'new' | 'same' | 'changed'
	diffRatio: number
	actualSize: string
	baselineSize: string
}

// Pierwsze uruchomienie zapisuje wzorzec, kolejne porównują z nim (akceptacja zmian: dashboard)
describe('Testy wizualne', () => {
	Object.entries(VIEWPORTS).forEach(([name, [w, h]]) => {
		forEachPage(`zrzut ${name} (${w}×${h}) zgodny ze wzorcem`, (page) => {
			const snapshot = `${pageSlug(page)}__${name}`
			cy.viewport(w, h)
			trackNetwork()
			cy.visit(page)
			waitForNetworkIdle()
			stabilizePage()
			// Przewijanie doładowuje lazy-load – czekamy jeszcze raz
			waitForNetworkIdle()
			cy.screenshot(`visual__${snapshot}`, { capture: 'fullPage', overwrite: true, blackout: VISUAL_MASK })
			cy.task<SnapshotResult>('compareSnapshot', snapshot).then((r) => {
				const pct = `${(r.diffRatio * 100).toFixed(2)}%`
				report(
					'visual',
					[
						r.status === 'new'
							? check('Utworzono wzorzec (pierwsze uruchomienie)', true, { value: r.actualSize })
							: check('Zgodność ze wzorcem', r.status === 'same', {
									value: `różnica ${pct}`,
									details: r.actualSize !== r.baselineSize ? [`Rozmiar strony: ${r.baselineSize} → ${r.actualSize}`] : undefined,
								}),
					],
					{ viewport: name, size: `${w}×${h}`, ...r }
				)
			})
		})
	})
})
