// Lighthouse w osobnym procesie (pakiet jest tylko ESM i uruchamia własnego Chrome'a).
// Użycie: node scripts/lighthouse.mjs <url> <mobile|desktop> <plik.html>
// Na stdout wypisuje JSON z podsumowaniem, pełny raport zapisuje do pliku HTML.
import fs from 'node:fs'
import path from 'node:path'
import lighthouse from 'lighthouse'
import desktopConfig from 'lighthouse/core/config/desktop-config.js'
import * as chromeLauncher from 'chrome-launcher'

const [url, formFactor = 'mobile', htmlOut] = process.argv.slice(2)
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo']
const METRICS = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index']

const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-first-run', '--disable-gpu'] })
try {
	const result = await lighthouse(
		url,
		{ port: chrome.port, output: 'html', logLevel: 'error', locale: 'pl', onlyCategories: CATEGORIES },
		formFactor === 'desktop' ? desktopConfig : undefined
	)
	const { lhr } = result
	if (htmlOut) {
		fs.mkdirSync(path.dirname(htmlOut), { recursive: true })
		fs.writeFileSync(htmlOut, result.report)
	}

	// Audyt -> kategoria, żeby dashboard mógł pogrupować problemy
	const auditCategory = {}
	for (const cat of Object.values(lhr.categories)) for (const ref of cat.auditRefs) auditCategory[ref.id] ??= cat.id

	const failing = Object.values(lhr.audits)
		.filter((a) => a.score !== null && a.score < 0.9 && ['binary', 'numeric', 'metricSavings'].includes(a.scoreDisplayMode))
		.filter((a) => auditCategory[a.id] && !METRICS.includes(a.id))
		.sort((a, b) => a.score - b.score)
		.slice(0, 40)
		.map((a) => ({ id: a.id, title: a.title, score: Math.round(a.score * 100), displayValue: a.displayValue ?? '', category: auditCategory[a.id] }))

	process.stdout.write(
		JSON.stringify({
			formFactor,
			finalUrl: lhr.finalDisplayedUrl,
			scores: Object.fromEntries(Object.entries(lhr.categories).map(([id, c]) => [id, Math.round((c.score ?? 0) * 100)])),
			metrics: METRICS.map((id) => ({ id, title: lhr.audits[id]?.title, value: lhr.audits[id]?.displayValue ?? '', score: lhr.audits[id]?.score ?? null })),
			failing,
			warnings: lhr.runWarnings,
		})
	)
} finally {
	await chrome.kill()
}
