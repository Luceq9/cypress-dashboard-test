import { defineConfig } from 'cypress'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { HtmlValidate } from 'html-validate'

const RESULTS_FILE = path.join(__dirname, 'dashboard', 'results.json')
const REPORTS_DIR = path.join(__dirname, 'dashboard', 'reports')
const LIGHTHOUSE_SCRIPT = path.join(__dirname, 'scripts', 'lighthouse.mjs')
const SCREENSHOTS_DIR = path.join(__dirname, 'cypress', 'screenshots')
const VISUAL_DIR = path.join(__dirname, 'cypress', 'visual')
const MAX_RUNS = 30
const VISUAL_PREFIX = 'visual__'
// Odsetek różniących się pikseli, powyżej którego zrzut uznajemy za zmieniony
const VISUAL_MAX_DIFF = 0.005

type Report = { category: string; test: string; page: string; checks: unknown[]; extra?: Record<string, unknown> }

// ---------- Wyznaczanie podstron do audytu ----------

const ASSET = /\.(jpe?g|png|gif|webp|avif|svg|ico|pdf|zip|docx?|xlsx?|css|js|xml|txt|json|mp4|mp3|woff2?)$/i
// Panel, API, wylogowanie i akcje koszyka WooCommerce – nie audytujemy
const SKIP = /\/(wp-admin|wp-login|wp-json|feed|xmlrpc|logout|wyloguj)\b|[?&](add-to-cart|remove_item|replytocom|s)=/i

async function fetchText(url: string) {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
		return res.ok ? await res.text() : ''
	} catch {
		return ''
	}
}

/** Ścieżka na testowanej domenie; `anyHost` – sitemapa kopii sklepu często ma adresy produkcji */
function toPath(href: string, origin: string, anyHost = false) {
	try {
		const u = new URL(href.replace(/&amp;/g, '&'), origin)
		if (!/^https?:$/.test(u.protocol) || (!anyHost && u.origin !== origin)) return null
		if (ASSET.test(u.pathname) || SKIP.test(u.pathname + u.search)) return null
		return u.pathname + u.search
	} catch {
		return null
	}
}

async function pagesFromSitemap(origin: string, max: number) {
	const robots = await fetchText(`${origin}/robots.txt`)
	const queue = [
		...[...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]),
		...['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'].map((p) => origin + p),
	]
	const seen = new Set<string>()
	const pages = new Set<string>()
	while (queue.length && pages.size < max && seen.size < 25) {
		const url = queue.shift()!
		if (seen.has(url)) continue
		seen.add(url)
		const xml = await fetchText(url)
		const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])
		if (/<sitemapindex/.test(xml)) {
			queue.push(...locs.map((l) => toPath(l, origin, true) && origin + toPath(l, origin, true)).filter((l): l is string => !!l))
			continue
		}
		for (const loc of locs) {
			const p = toPath(loc, origin, true)
			if (p) pages.add(p)
			if (pages.size >= max) break
		}
	}
	return [...pages]
}

/** Przeszukiwanie wszerz od strony głównej po linkach wewnętrznych */
async function pagesFromCrawl(origin: string, max: number) {
	const pages = ['/']
	const seen = new Set(pages)
	for (let i = 0; i < pages.length && pages.length < max; i++) {
		const html = await fetchText(origin + pages[i])
		for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#]+)/gi)) {
			const p = toPath(m[1], origin)
			if (p && !seen.has(p)) {
				seen.add(p)
				pages.push(p)
				if (pages.length >= max) break
			}
		}
	}
	return pages
}

async function discoverPages(baseUrl: string, source: string, max: number, list: string) {
	const origin = new URL(baseUrl).origin
	let pages: string[] = []
	if (source === 'sitemap') pages = await pagesFromSitemap(origin, max)
	else if (source === 'crawl') pages = await pagesFromCrawl(origin, max)
	else if (source === 'list')
		pages = list
			.split(/[\s,]+/)
			.filter(Boolean)
			.map((l) => toPath(l.startsWith('http') ? l : origin + (l.startsWith('/') ? l : `/${l}`), origin, true))
			.filter((p): p is string => !!p)
	// Strona główna zawsze pierwsza
	return [...new Set(source === 'list' && pages.length ? pages : ['/', ...pages])].slice(0, Math.max(max, 1))
}

// ---------- Walidacja HTML ----------

const htmlValidator = new HtmlValidate({
	extends: ['html-validate:standard', 'html-validate:a11y'],
	rules: {
		// Styl zapisu, nie błędy – tylko zaśmiecałyby raport
		'no-inline-style': 'off',
		'no-trailing-whitespace': 'off',
		'attr-quotes': 'off',
		'void-style': 'off',
		'attr-case': 'off',
		'attribute-boolean-style': 'off',
		'no-implicit-button-type': 'off',
		'no-implicit-input-type': 'off',
	},
})

// Reguły oznaczające realnie zepsuty dokument lub problem dostępności
const HTML_FAIL_RULES = /^(no-dup-id|close-order|no-dup-attr|element-permitted-content|element-permitted-parent|wcag\/.*|input-missing-label|no-redundant-for|valid-id)$/

// Ten sam klucz liczy dashboard/server.mjs – wzorce wizualne trzymamy osobno dla każdej domeny
const hostKey = (baseUrl: string) => new URL(baseUrl).host.replace(/[^\w.-]/g, '_')

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

function padTo(img: PNG, width: number, height: number) {
	if (img.width === width && img.height === height) return img
	const out = new PNG({ width, height })
	PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0)
	return out
}

export default defineConfig({
	e2e: {
		baseUrl: 'https://test.dostepnemiejsce.pl/', // adres KOPII sklepu, nie produkcji
		viewportWidth: 1366,
		viewportHeight: 768,
		defaultCommandTimeout: 8000,
		video: false,
		async setupNodeEvents(on, config) {
			const host = hostKey(config.baseUrl!)
			const visualDir = (kind: 'baseline' | 'actual' | 'diff') => path.join(VISUAL_DIR, host, kind)
			let reports: Report[] = []

			// Zakres: --expose pageSource=sitemap,maxPages=20 albo zmienne AUDIT_* (ustawia je dashboard)
			const pageSource = String(config.expose?.pageSource ?? process.env.AUDIT_PAGE_SOURCE ?? 'home')
			const maxPages = Number(config.expose?.maxPages ?? process.env.AUDIT_MAX_PAGES ?? 10)
			const pageList = String(config.expose?.pageList ?? process.env.AUDIT_PAGES ?? '')
			const pages = await discoverPages(config.baseUrl!, pageSource, maxPages, pageList)
			config.expose = { ...config.expose, pages }
			console.log(`[audyt] ${pages.length} stron (${pageSource}): ${pages.join(' ')}`)

			// Domyślne okno headless (1280×720) przeskalowałoby zrzuty większych viewportów
			on('before:browser:launch', (browser, launchOptions) => {
				if (browser.name === 'electron') {
					launchOptions.preferences.width = 1920
					launchOptions.preferences.height = 1200
				} else if (browser.family === 'chromium') {
					launchOptions.args.push('--window-size=1920,1200')
				}
				return launchOptions
			})

			on('before:run', () => {
				reports = []
			})

			on('task', {
				report(r: Report) {
					reports.push(r)
					return null
				},

				// Zapytanie z poziomu Node – nie wywala testu przy błędzie sieci i nie podąża za przekierowaniem
				async httpCheck({ url, method = 'GET' }: { url: string; method?: string }) {
					try {
						const res = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(15000) })
						const body = (await res.text()).slice(0, 2000)
						return { status: res.status, location: res.headers.get('location'), body }
					} catch (e) {
						return { status: 0, location: null, body: '', error: (e as Error).message }
					}
				},

				lighthouse({ url, formFactor, name }: { url: string; formFactor: 'mobile' | 'desktop'; name: string }) {
					const htmlOut = path.join(REPORTS_DIR, host, 'lighthouse', `${name}.html`)
					const env = { ...process.env }
					delete env.ELECTRON_RUN_AS_NODE
					return new Promise((resolve) => {
						// Systemowy node – Lighthouse wymaga nowszego niż ten wbudowany w niektóre wersje Cypressa
						execFile('node', [LIGHTHOUSE_SCRIPT, url, formFactor, htmlOut], { env, timeout: 180000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
							if (err) return resolve({ error: (stderr || err.message).slice(0, 2000) })
							try {
								resolve({ ...JSON.parse(stdout), reportUrl: `/reports/${host}/lighthouse/${name}.html` })
							} catch {
								resolve({ error: `Nieczytelny wynik Lighthouse: ${stdout.slice(0, 500)}` })
							}
						})
					})
				},

				async validateHtml(html: string) {
					const result = await htmlValidator.validateString(html)
					const byRule = new Map<string, { rule: string; severity: 'fail' | 'warn'; count: number; examples: string[] }>()
					for (const m of result.results.flatMap((r) => r.messages)) {
						const entry = byRule.get(m.ruleId) ?? {
							rule: m.ruleId,
							severity: HTML_FAIL_RULES.test(m.ruleId) ? 'fail' : 'warn',
							count: 0,
							examples: [],
						}
						entry.count++
						if (entry.examples.length < 10) entry.examples.push(`l. ${m.line}: ${m.message}`)
						byRule.set(m.ruleId, entry)
					}
					return [...byRule.values()].sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === 'fail' ? -1 : 1))
				},

				compareSnapshot(name: string) {
					const file = `${name}.png`
					const urls = Object.fromEntries(
						(['baseline', 'actual', 'diff'] as const).map((k) => [k, `/visual/${host}/${k}/${file}`])
					)
					const actualPath = path.join(visualDir('actual'), file)
					const baselinePath = path.join(visualDir('baseline'), file)
					const actual = PNG.sync.read(fs.readFileSync(actualPath))
					const actualSize = `${actual.width}×${actual.height}`

					if (!fs.existsSync(baselinePath)) {
						fs.mkdirSync(visualDir('baseline'), { recursive: true })
						fs.copyFileSync(actualPath, baselinePath)
						return { status: 'new', diffRatio: 0, actualSize, baselineSize: actualSize, urls, host, name }
					}

					const baseline = PNG.sync.read(fs.readFileSync(baselinePath))
					const width = Math.max(actual.width, baseline.width)
					const height = Math.max(actual.height, baseline.height)
					const diff = new PNG({ width, height })
					const diffPixels = pixelmatch(
						padTo(baseline, width, height).data,
						padTo(actual, width, height).data,
						diff.data,
						width,
						height,
						{ threshold: 0.1 }
					)
					fs.mkdirSync(visualDir('diff'), { recursive: true })
					fs.writeFileSync(path.join(visualDir('diff'), file), PNG.sync.write(diff))

					const diffRatio = diffPixels / (width * height)
					return {
						status: diffRatio > VISUAL_MAX_DIFF ? 'changed' : 'same',
						diffPixels,
						diffRatio,
						maxDiff: VISUAL_MAX_DIFF,
						actualSize,
						baselineSize: `${baseline.width}×${baseline.height}`,
						urls,
						host,
						name,
					}
				},
			})

			// Zrzuty `visual__*` przenosimy do cypress/visual/<host>/actual, żeby nie kasował ich trashAssetsBeforeRuns
			on('after:screenshot', (details) => {
				if (!details.name?.startsWith(VISUAL_PREFIX)) return
				const target = path.join(visualDir('actual'), `${details.name.slice(VISUAL_PREFIX.length)}.png`)
				fs.mkdirSync(path.dirname(target), { recursive: true })
				fs.copyFileSync(details.path, target)
				fs.rmSync(details.path)
				return { path: target }
			})

			// Po każdym `cypress run` dopisujemy wynik do dashboard/results.json
			on('after:run', (results) => {
				if (!results || !('runs' in results)) return

				const run = {
					startedAt: results.startedTestsAt,
					duration: results.totalDuration,
					baseUrl: config.baseUrl,
					host,
					pageSource,
					pages,
					browser: `${results.browserName} ${results.browserVersion}`,
					totals: {
						tests: results.totalTests,
						passed: results.totalPassed,
						failed: results.totalFailed,
						pending: results.totalPending,
						skipped: results.totalSkipped,
					},
					tests: results.runs.flatMap((r) =>
						r.tests.map((t) => {
							const key = normalize(t.title.join(''))
							const shot = r.screenshots.find(
								(s) => s.path.includes('(failed)') && normalize(path.basename(s.path)).includes(key)
							)
							return {
								spec: r.spec.relative,
								title: t.title.join(' › '),
								state: t.state,
								duration: t.duration,
								error: t.displayError ?? null,
								screenshot: shot
									? '/screenshots/' + path.relative(SCREENSHOTS_DIR, shot.path).split(path.sep).join('/')
									: null,
							}
						})
					),
					reports,
				}

				let history: unknown[] = []
				if (fs.existsSync(RESULTS_FILE)) {
					try {
						history = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'))
					} catch {
						history = []
					}
				}
				history.unshift(run)
				fs.writeFileSync(RESULTS_FILE, JSON.stringify(history.slice(0, MAX_RUNS), null, 2))
			})

			return config
		},
	},
})
