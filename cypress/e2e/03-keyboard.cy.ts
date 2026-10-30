import { check, describeEl, isVisible, report, forEachPage } from '../support/audit'

const MAX_TABS = 40

interface Step { el: string; visible: boolean; indicator: boolean }

// Styl, który zmienia się, gdy element (lub jego rodzic przez :focus-within) dostaje fokus
function focusStyle(el: Element) {
	const props = ['outlineStyle', 'outlineWidth', 'outlineColor', 'boxShadow', 'backgroundColor', 'color', 'borderColor', 'textDecorationLine'] as const
	const win = el.ownerDocument.defaultView!
	return [el, el.parentElement]
		.filter((e): e is Element => !!e)
		.map((e) => {
			const cs = win.getComputedStyle(e)
			return props.map((p) => cs[p]).join('|')
		})
		.join('||')
}

describe('Obsługa klawiaturą', () => {
	forEachPage('skip link, widoczny fokus i brak pułapek klawiaturowych', (page) => {
		const steps: Step[] = []
		cy.visit(page)

		Cypress._.times(MAX_TABS, () => {
			cy.press(Cypress.Keyboard.Keys.TAB)
			cy.document({ log: false }).then((doc) => {
				const el = doc.activeElement as HTMLElement | null
				if (!el || el === doc.body) return
				const focused = focusStyle(el)
				el.blur()
				const blurred = focusStyle(el)
				el.focus({ preventScroll: true })
				steps.push({
					el: describeEl(el),
					// iframe (np. reCAPTCHA, mapa) zarządza fokusem sam – nie oceniamy go
					visible: el.tagName === 'IFRAME' || isVisible(el),
					indicator: el.tagName === 'IFRAME' || focused !== blurred,
				})
			})
		})

		cy.document().then((doc) => {
			const first = steps[0]?.el ?? ''
			const invisible = steps.filter((s) => !s.visible).map((s) => s.el)
			const noIndicator = steps.filter((s) => s.visible && !s.indicator).map((s) => s.el)
			const trapped = steps.some(
				(s, i) => i >= 2 && s.el === steps[i - 1].el && s.el === steps[i - 2].el && !s.el.startsWith('iframe')
			)
			const positiveTabindex = [...doc.querySelectorAll('[tabindex]')].filter((e) => Number(e.getAttribute('tabindex')) > 0)

			report(
				'keyboard',
				[
					check('Elementy osiągalne klawiszem Tab', steps.length > 0, { value: `${steps.length} z ${MAX_TABS} naciśnięć` }),
					check('Pierwszy Tab trafia w link „przejdź do treści”', /^a\b.*(przejd|pomi|skip|tre[sś]ci|content|main)/i.test(first), {
						warnOnly: true,
						value: first || '—',
						ref: 'WCAG 2.4.1',
					}),
					check('Fokus nie trafia w niewidoczne elementy', invisible.length === 0, {
						value: invisible.length,
						details: invisible,
						ref: 'WCAG 2.4.7',
					}),
					check('Widoczny wskaźnik fokusu', noIndicator.length === 0, {
						value: noIndicator.length,
						details: noIndicator,
						ref: 'WCAG 2.4.7',
					}),
					check('Brak pułapki klawiaturowej', !trapped, { ref: 'WCAG 2.1.2' }),
					check('Brak tabindex > 0', positiveTabindex.length === 0, {
						warnOnly: true,
						value: positiveTabindex.length,
						details: positiveTabindex.map(describeEl),
						ref: 'WCAG 2.4.3',
					}),
				],
				{ steps }
			)
		})
	})
})
