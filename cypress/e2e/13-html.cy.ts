import { Check, forEachPage, report } from '../support/audit'

interface RuleResult { rule: string; severity: 'fail' | 'warn'; count: number; examples: string[] }

// Walidacja kodu HTML offline (html-validate: reguły poprawności + dostępności), bez wysyłania strony na zewnątrz
describe('Walidacja HTML', () => {
	forEachPage('kod HTML jest poprawny', (page) => {
		cy.request(page).then((res) => {
			cy.task<RuleResult[]>('validateHtml', res.body).then((rules) => {
				const checks: Check[] = [
					{
						label: 'Brak błędów HTML łamiących strukturę lub dostępność',
						status: rules.some((r) => r.severity === 'fail') ? 'fail' : 'pass',
						value: `${rules.filter((r) => r.severity === 'fail').reduce((s, r) => s + r.count, 0)} wystąpień`,
					},
					...rules.map(
						(r): Check => ({
							label: r.rule,
							status: r.severity,
							value: `${r.count}×`,
							details: r.examples,
							ref: `https://html-validate.org/rules/${r.rule}.html`,
						})
					),
				]
				report('html', checks, { rules })
			})
		})
	})
})
