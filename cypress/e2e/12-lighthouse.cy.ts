import { check, forEachPage, pageSlug, report } from '../support/audit'

interface LighthouseResult {
	error?: string
	scores: Record<string, number>
	metrics: { id: string; title: string; value: string; score: number | null }[]
	failing: { id: string; title: string; score: number; displayValue: string; category: string }[]
	reportUrl: string
}

const CATEGORY_NAMES: Record<string, string> = {
	performance: 'Wydajność',
	accessibility: 'Dostępność',
	'best-practices': 'Dobre praktyki',
	seo: 'SEO',
}

// Progi kolorów Lighthouse: ≥ 90 zielony, 50–89 pomarańczowy, < 50 czerwony
const scoreCheck = (name: string, score: number) =>
	check(`Lighthouse: ${name}`, score >= 90, { value: `${score}/100`, warnOnly: score >= 50 })

// Lighthouse uruchamia osobnego Chrome'a z symulacją wolnego telefonu (mobile) albo desktopu
describe('Lighthouse', () => {
	;(['mobile', 'desktop'] as const).forEach((formFactor) => {
		forEachPage(`audyt Lighthouse – ${formFactor}`, (page) => {
			const url = new URL(page, Cypress.config('baseUrl')!).href
			cy.task<LighthouseResult>('lighthouse', { url, formFactor, name: `${pageSlug(page)}__${formFactor}` }, { timeout: 240000 }).then((r) => {
				if (r.error) {
					report('lighthouse', [check('Lighthouse uruchomił się poprawnie', false, { details: [r.error] })])
					return
				}
				report(
					'lighthouse',
					[
						...Object.entries(r.scores).map(([id, score]) => scoreCheck(CATEGORY_NAMES[id] ?? id, score)),
						// Metryki składają się na wynik „Wydajność” – nie karzemy za nie drugi raz
						...r.metrics.map((m) => check(m.title, (m.score ?? 1) >= 0.9, { value: m.value, warnOnly: true })),
					],
					{ formFactor, ...r }
				)
			})
		})
	})
})
