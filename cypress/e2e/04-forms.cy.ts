import { check, describeEl, isVisible, report, forEachPage } from '../support/audit'

const FIELDS =
	'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea'
const TEXT_TYPES = ['text', 'email', 'tel', 'search', 'url', 'number', 'password', '']
const PERSONAL = /e-?mail|phone|tel|imie|imię|name|nazwisko|surname|adres|address|zip|postcode|kod|city|miasto/i
const SAMPLE: Record<string, string> = { email: 'test@example.com', tel: '123456789', number: '42', url: 'https://example.com' }

function accessibleName(el: HTMLInputElement) {
	const doc = el.ownerDocument
	const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
		.split(/\s+/)
		.map((id) => (id ? doc.getElementById(id)?.textContent ?? '' : ''))
		.join(' ')
	const labels = [...(el.labels ?? [])].map((l) => l.textContent ?? '').join(' ')
	return (el.getAttribute('aria-label') || labelledBy || labels || el.title || '').trim()
}

describe('Formularze i pola', () => {
	forEachPage('pola mają etykiety, poprawne typy i przyjmują dane', (page) => {
		cy.visit(page)
		cy.document().then((doc) => {
			const fields = [...doc.querySelectorAll<HTMLInputElement>(FIELDS)]
			const unlabeled = fields.filter((f) => !accessibleName(f))
			const placeholderOnly = unlabeled.filter((f) => f.placeholder)
			const buttons = [...doc.querySelectorAll<HTMLElement>('button, [role=button], input[type=submit], input[type=button]')]
			const namelessButtons = buttons.filter(
				(b) =>
					!(
						b.getAttribute('aria-label') ||
						b.textContent?.trim() ||
						(b as HTMLInputElement).value ||
						b.title ||
						b.querySelector('img[alt]:not([alt=""])')
					)
			)
			const personal = fields.filter((f) => f.type !== 'checkbox' && PERSONAL.test(`${f.name} ${f.id} ${f.type}`))
			const noAutocomplete = personal.filter((f) => !f.getAttribute('autocomplete'))
			const wrongEmailType = fields.filter(
				(f) => /e-?mail/i.test(`${f.name} ${f.id}`) && f.tagName === 'INPUT' && !['email', 'checkbox', 'radio'].includes(f.type)
			)
			const typable = fields.filter(
				(f) =>
					(f.tagName === 'TEXTAREA' || (f.tagName === 'INPUT' && TEXT_TYPES.includes(f.type))) &&
					isVisible(f) &&
					!f.disabled &&
					!f.readOnly
			)

			const notTyped: string[] = []
			typable.forEach((f) => {
				const value = SAMPLE[f.type] ?? 'Test 123'
				cy.wrap(f).clear().type(value, { delay: 0 })
				cy.wrap(f)
					.invoke('val')
					.then((v) => {
						if (v !== value) notTyped.push(describeEl(f))
					})
			})

			cy.then(() =>
				report(
					'forms',
					[
						check('Liczba pól formularzy', true, { value: `${fields.length} pól, ${doc.forms.length} formularzy` }),
						check('Każde pole ma etykietę', unlabeled.length === 0, {
							value: unlabeled.length,
							details: unlabeled.map(describeEl),
							ref: 'WCAG 1.3.1, 4.1.2',
						}),
						check('Brak pól z samym placeholderem zamiast etykiety', placeholderOnly.length === 0, {
							value: placeholderOnly.length,
							details: placeholderOnly.map(describeEl),
							ref: 'WCAG 3.3.2',
						}),
						check('Każdy przycisk ma nazwę', namelessButtons.length === 0, {
							value: namelessButtons.length,
							details: namelessButtons.map(describeEl),
							ref: 'WCAG 4.1.2',
						}),
						check('Pola danych osobowych mają autocomplete', noAutocomplete.length === 0, {
							warnOnly: true,
							value: noAutocomplete.length,
							details: noAutocomplete.map(describeEl),
							ref: 'WCAG 1.3.5',
						}),
						check('Pola e-mail mają type="email"', wrongEmailType.length === 0, {
							warnOnly: true,
							value: wrongEmailType.length,
							details: wrongEmailType.map(describeEl),
						}),
						check('Widoczne pola tekstowe przyjmują wpisywany tekst', notTyped.length === 0, {
							value: typable.length ? `${typable.length - notTyped.length}/${typable.length}` : 'brak widocznych pól',
							details: notTyped,
						}),
					],
					{
						fields: fields.map((f) => ({
							el: describeEl(f),
							type: f.type || f.tagName.toLowerCase(),
							label: accessibleName(f) || null,
							required: f.required,
						})),
					}
				)
			)
		})
	})
})
