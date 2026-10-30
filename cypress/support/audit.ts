// Wspólny format wyników dla dashboardu: każdy test zgłasza listę sprawdzeń pass/warn/fail
export type Status = 'pass' | 'warn' | 'fail'

export interface Check {
	label: string
	status: Status
	value?: string | number
	details?: string[]
	/** Kryterium WCAG albo krótka wskazówka, np. "WCAG 2.4.7" */
	ref?: string
}

interface CheckOptions {
	value?: string | number
	details?: string[]
	ref?: string
	/** Niespełnienie daje ostrzeżenie zamiast błędu */
	warnOnly?: boolean
}

export const check = (label: string, ok: boolean, opts: CheckOptions = {}): Check => ({
	label,
	status: ok ? 'pass' : opts.warnOnly ? 'warn' : 'fail',
	value: opts.value,
	details: opts.details?.length ? opts.details.slice(0, 50) : undefined,
	ref: opts.ref,
})

/** Podstrony do audytu – wyznacza je cypress.config.ts (pageSource: home | sitemap | crawl | list) */
export const PAGES: string[] = Cypress.expose('pages')?.length ? Cypress.expose('pages') : ['/']

let currentPage = '/'

/** "/" -> "home", "/pl/strony/kontakt" -> "pl-strony-kontakt" – do nazw plików */
export const pageSlug = (page: string) => (page === '/' ? 'home' : page.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'home')

/** Jeden test na każdą podstronę; raporty z tego testu są przypisane do strony */
export function forEachPage(title: string, fn: (page: string) => void, pages = PAGES) {
	pages.forEach((page) =>
		it(`${title} – ${page}`, () => {
			currentPage = page
			fn(page)
		})
	)
}

/** Wysyła wynik do dashboardu i failuje test, jeśli któreś sprawdzenie ma status `fail` */
export function report(category: string, checks: Check[], extra?: Record<string, unknown>) {
	const test = Cypress.currentTest.titlePath.join(' › ')
	return cy.task('report', { category, test, page: currentPage, checks, extra }, { log: false }).then(() => {
		const failed = checks
			.filter((c) => c.status === 'fail')
			.map((c) => (c.value === undefined ? c.label : `${c.label}: ${c.value}`))
		expect(failed, 'Nieudane sprawdzenia').to.be.empty
	})
}

/** Elementy z treścią zmienną między uruchomieniami – zamalowywane na zrzutach wizualnych */
export const VISUAL_MASK = ['iframe', 'video', 'canvas', '.gm-style', '[id*="map" i]', '[class*="carousel"]', '[class*="slider"]']

export const VIEWPORTS = {
	desktop: [1366, 768],
	tablet: [768, 1024],
	mobile: [375, 812],
} as const

/** Krótki, czytelny opis elementu do raportu, np. `a.nav-link "Kontakt"` */
export function describeEl(el: Element) {
	const id = el.id ? `#${el.id}` : ''
	const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
	const text = (
		el.getAttribute('aria-label') ||
		el.textContent?.trim() ||
		el.querySelector('img')?.getAttribute('alt') ||
		(el as HTMLInputElement).value ||
		''
	)
		.trim()
		.replace(/\s+/g, ' ')
		.slice(0, 40)
	return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`
}

export function isVisible(el: Element) {
	const r = el.getBoundingClientRect()
	const style = el.ownerDocument.defaultView!.getComputedStyle(el)
	return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0
}

const network = { pending: 0, lastChange: 0 }

/** Zaczyna liczyć trwające zapytania – wywołaj przed cy.visit() */
export function trackNetwork() {
	network.pending = 0
	network.lastChange = Date.now()
	cy.intercept({ url: /.*/ }, (req) => {
		network.pending++
		network.lastChange = Date.now()
		req.on('after:response', () => {
			network.pending--
			network.lastChange = Date.now()
		})
	})
}

/**
 * Czeka, aż przez `quietMs` nie będzie trwających zapytań (treści ładowane AJAX-em).
 * Po `maxMs` idzie dalej, żeby wiszące zapytanie (np. analityka) nie blokowało testu.
 */
export function waitForNetworkIdle(quietMs = 1000, maxMs = 15000) {
	let deadline = 0
	const poll = (): void => {
		cy.wait(250, { log: false }).then(() => {
			const busy = network.pending > 0 || Date.now() - network.lastChange < quietMs
			if (busy && Date.now() < deadline) poll()
		})
	}
	cy.then(() => {
		deadline = Date.now() + maxMs
		poll()
	})
}

/** Wyłącza animacje, doładowuje lazy-load i czeka na fonty/obrazki – stabilne zrzuty */
export function stabilizePage() {
	cy.document({ log: false }).then((doc) => {
		const style = doc.createElement('style')
		style.textContent =
			'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}'
		doc.head.appendChild(style)
	})
	cy.document({ log: false }).its('fonts.status').should('eq', 'loaded')
	cy.window({ log: false }).then((win) => {
		const steps = Math.ceil(win.document.documentElement.scrollHeight / win.innerHeight)
		Cypress._.times(steps, (i) => {
			cy.scrollTo(0, i * win.innerHeight, { ensureScrollable: false, log: false })
			cy.wait(150, { log: false })
		})
	})
	cy.scrollTo('top', { ensureScrollable: false, log: false })
	// Zrzut fullPage jest sklejany z kawałków – elementy fixed (baner cookies, czat, „do góry”)
	// powtarzałyby się na każdym, więc je ukrywamy; sticky przypinamy do normalnego miejsca
	cy.document({ log: false }).then((doc) => {
		const win = doc.defaultView!
		doc.querySelectorAll<HTMLElement>('body *').forEach((el) => {
			const pos = win.getComputedStyle(el).position
			if (pos === 'fixed') el.style.setProperty('visibility', 'hidden', 'important')
			if (pos === 'sticky') el.style.setProperty('position', 'static', 'important')
		})
	})
	cy.document({ log: false }).should((doc) => {
		expect([...doc.images].every((img) => img.complete), 'wszystkie obrazki załadowane').to.be.true
	})
}
