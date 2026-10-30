import { check, forEachPage, report, VIEWPORTS } from '../support/audit'

// Reguły axe-core: WCAG 2.0/2.1/2.2 poziom A i AA + dobre praktyki
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

interface AxeNode { target: string[]; html: string; failureSummary?: string }
interface AxeResult { id: string; impact: string | null; help: string; description: string; helpUrl: string; tags: string[]; nodes: AxeNode[] }

// "wcag1410" -> "1.4.10"
const wcagCriteria = (tags: string[]) =>
	tags.flatMap((t) => {
		const m = t.match(/^wcag(\d)(\d)(\d+)$/)
		return m ? [`${m[1]}.${m[2]}.${m[3]}`] : []
	})

const simplify = (r: AxeResult) => ({
	id: r.id,
	impact: r.impact,
	help: r.help,
	description: r.description,
	helpUrl: r.helpUrl,
	wcag: wcagCriteria(r.tags),
	nodeCount: r.nodes.length,
	nodes: r.nodes.slice(0, 15).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 300), summary: n.failureSummary ?? '' })),
})

describe('Dostępność – audyt axe-core (WCAG 2.2 AA)', () => {
	;(['desktop', 'mobile'] as const).forEach((name) => {
		forEachPage(`brak naruszeń WCAG – ${name}`, (page) => {
			const [w, h] = VIEWPORTS[name]
			cy.viewport(w, h)
			cy.visit(page)
			cy.readFile('node_modules/axe-core/axe.min.js', { log: false }).then((source: string) => {
				cy.window().then({ timeout: 60000 }, (win) => {
					const aut = win as unknown as { eval(s: string): void; axe: { run(ctx: Document, opts: object): Promise<{ violations: AxeResult[]; incomplete: AxeResult[]; passes: AxeResult[] }> } }
					aut.eval(source)
					return aut.axe.run(win.document, { runOnly: { type: 'tag', values: AXE_TAGS }, resultTypes: ['violations', 'incomplete'] })
				}).then((results) => {
					const violations = results.violations.map(simplify)
					const incomplete = results.incomplete.map(simplify)
					const wcagViolations = violations.filter((v) => v.wcag.length)

					report(
						'a11y',
						[
							check('Brak naruszeń kryteriów WCAG A/AA', wcagViolations.length === 0, { value: `${wcagViolations.length} reguł` }),
							...violations.map((v) =>
								check(`${v.help} (${v.id})`, false, {
									warnOnly: v.wcag.length === 0,
									value: `${v.nodeCount} elem. · ${v.impact}`,
									ref: v.wcag.length ? `WCAG ${v.wcag.join(', ')}` : 'dobra praktyka',
									details: v.nodes.map((n) => n.target),
								})
							),
							check('Elementy do ręcznej weryfikacji', incomplete.length === 0, { warnOnly: true, value: incomplete.length }),
						],
						{ viewport: name, violations, incomplete, passes: results.passes.length }
					)
				})
			})
		})
	})
})
