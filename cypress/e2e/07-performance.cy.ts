import { check, Check, describeEl, forEachPage, report } from '../support/audit'

// Progi Google: [dobry, wymaga poprawy] – powyżej drugiego = słaby
const BUDGETS = {
	ttfb: { label: 'TTFB (czas do pierwszego bajtu)', unit: 'ms', good: 800, poor: 1800 },
	fcp: { label: 'FCP (pierwsze wyrenderowanie treści)', unit: 'ms', good: 1800, poor: 3000 },
	lcp: { label: 'LCP (największy element)', unit: 'ms', good: 2500, poor: 4000 },
	cls: { label: 'CLS (przesunięcia układu)', unit: '', good: 0.1, poor: 0.25 },
	load: { label: 'Pełne załadowanie (load)', unit: 'ms', good: 3000, poor: 6000 },
	weight: { label: 'Waga strony', unit: 'KB', good: 2000, poor: 4000 },
	requests: { label: 'Liczba żądań', unit: '', good: 80, poor: 150 },
} as const

type Metric = keyof typeof BUDGETS
type PerfWindow = Window & { __perf?: { lcp: number; cls: number } }

const rate = (key: Metric, v: number) => (v <= BUDGETS[key].good ? 'good' : v <= BUDGETS[key].poor ? 'needs-improvement' : 'poor')

describe('Wydajność', () => {
	forEachPage('Core Web Vitals i waga strony mieszczą się w budżecie', (page) => {
		cy.request(page).then((res) => {
			cy.visit(page, {
				onBeforeLoad(win) {
					const w = win as PerfWindow
					const p = (w.__perf = { lcp: 0, cls: 0 })
					try {
						new win.PerformanceObserver((list) => {
							for (const e of list.getEntries()) p.lcp = e.startTime
						}).observe({ type: 'largest-contentful-paint', buffered: true })
						new win.PerformanceObserver((list) => {
							for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
								if (!e.hadRecentInput) p.cls += e.value
						}).observe({ type: 'layout-shift', buffered: true })
					} catch {
						// przeglądarka bez wsparcia LCP/CLS – metryki zostaną 0
					}
				},
			})
			cy.document().its('readyState').should('eq', 'complete')
			cy.wait(2000)

			cy.window().then((win) => {
				const perf = win.performance
				const nav = perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
				const resources = perf.getEntriesByType('resource') as PerformanceResourceTiming[]
				const size = (r: PerformanceResourceTiming) => r.transferSize || r.encodedBodySize
				const totalBytes = size(nav) + resources.reduce((sum, r) => sum + size(r), 0)
				const { lcp, cls } = (win as PerfWindow).__perf ?? { lcp: 0, cls: 0 }

				const values: Record<Metric, number> = {
					ttfb: Math.round(nav.responseStart),
					fcp: Math.round(perf.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0),
					lcp: Math.round(lcp),
					cls: Number(cls.toFixed(3)),
					load: Math.round(nav.loadEventEnd),
					weight: Math.round(totalBytes / 1024),
					requests: resources.length + 1,
				}

				const byType: Record<string, { count: number; kb: number }> = {}
				resources.forEach((r) => {
					const t = (byType[r.initiatorType] ??= { count: 0, kb: 0 })
					t.count++
					t.kb += size(r) / 1024
				})
				const largest = [...resources]
					.sort((a, b) => size(b) - size(a))
					.slice(0, 8)
					.map((r) => ({ url: r.name, kb: Math.round(size(r) / 1024) }))

				const doc = win.document
				const noDimensions = [...doc.images].filter((i) => !i.getAttribute('width') || !i.getAttribute('height'))
				// SVG skaluje się bez strat – liczymy tylko bitmapy
				const oversized = [...doc.images].filter(
					(i) => !/\.svg(\?|$)/i.test(i.currentSrc || i.src) && i.clientWidth > 0 && i.naturalWidth > i.clientWidth * 2.5
				)
				const encoding = res.headers['content-encoding']

				const checks: Check[] = (Object.keys(BUDGETS) as Metric[]).map((key) => {
					const b = BUDGETS[key]
					const rating = rate(key, values[key])
					return {
						label: b.label,
						status: rating === 'good' ? 'pass' : rating === 'poor' ? 'fail' : 'warn',
						value: `${values[key]}${b.unit ? ' ' + b.unit : ''} (dobry ≤ ${b.good})`,
					}
				})
				checks.push(
					check('Kompresja HTML (gzip/brotli)', !!encoding, { warnOnly: true, value: String(encoding ?? 'brak') }),
					check('Obrazki mają width/height (mniej przesunięć)', noDimensions.length === 0, {
						warnOnly: true,
						value: noDimensions.length,
						details: noDimensions.map((i) => i.currentSrc || i.src),
					}),
					check('Obrazki nie są wielokrotnie większe niż wyświetlane', oversized.length === 0, {
						warnOnly: true,
						value: oversized.length,
						details: oversized.map((i) => `${describeEl(i)} ${i.naturalWidth}px → ${i.clientWidth}px`),
					})
				)

				report('performance', checks, {
					metrics: (Object.keys(BUDGETS) as Metric[]).map((key) => ({ key, ...BUDGETS[key], value: values[key], rating: rate(key, values[key]) })),
					byType: Object.entries(byType).map(([type, v]) => ({ type, count: v.count, kb: Math.round(v.kb) })),
					largest,
				})
			})
		})
	})
})
