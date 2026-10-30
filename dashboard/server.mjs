// Serwer dashboardu bez zależności: node dashboard/server.mjs → http://localhost:4000
// Serwuje wyniki, zrzuty ekranu i pozwala uruchamiać Cypressa z przeglądarki.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DASH_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DASH_DIR, '..')
const SPECS_DIR = path.join(ROOT, 'cypress', 'e2e')
const VISUAL_DIR = path.join(ROOT, 'cypress', 'visual')
const SCREENSHOTS_DIR = path.join(ROOT, 'cypress', 'screenshots')
const REPORTS_DIR = path.join(DASH_DIR, 'reports')
const PORT = Number(process.env.PORT) || 4000
const MAX_LOG = 60_000

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
}

let job = { running: false, log: '', startedAt: null, finishedAt: null, exitCode: null, baseUrl: null, specs: [] }

const listSpecs = () => fs.readdirSync(SPECS_DIR).filter((f) => f.endsWith('.cy.ts')).sort()

function defaultBaseUrl() {
	const config = fs.readFileSync(path.join(ROOT, 'cypress.config.ts'), 'utf8')
	return config.match(/baseUrl:\s*['"]([^'"]+)/)?.[1] ?? ''
}

// Ten sam klucz liczy cypress.config.ts
const hostKey = (baseUrl) => new URL(baseUrl).host.replace(/[^\w.-]/g, '_')

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')

function startRun({ baseUrl, specs, pageSource, maxPages, pageList }) {
	const args = [path.join(ROOT, 'node_modules', 'cypress', 'bin', 'cypress'), 'run']
	if (baseUrl) args.push('--config', `baseUrl=${baseUrl}`)
	if (specs.length) args.push('--spec', specs.map((s) => `cypress/e2e/${s}`).join(','))

	// Zakres stron czyta cypress.config.ts (zmienne środowiskowe – lista adresów nie mieści się w --expose)
	const env = {
		...process.env,
		NO_COLOR: '1',
		FORCE_COLOR: '0',
		AUDIT_PAGE_SOURCE: pageSource,
		AUDIT_MAX_PAGES: String(maxPages),
		AUDIT_PAGES: pageList,
	}
	// Ustawiane przez VS Code – z nim Cypress (Electron) nie startuje
	delete env.ELECTRON_RUN_AS_NODE

	job = { running: true, log: '', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, baseUrl, specs }
	const child = spawn(process.execPath, args, { cwd: ROOT, env })
	const append = (chunk) => {
		job.log = (job.log + stripAnsi(chunk.toString('utf8'))).slice(-MAX_LOG)
	}
	child.stdout.on('data', append)
	child.stderr.on('data', append)
	child.on('error', (err) => append(`\n[dashboard] Nie udało się uruchomić Cypressa: ${err.message}\n`))
	child.on('close', (code) => {
		job.running = false
		job.exitCode = code
		job.finishedAt = new Date().toISOString()
	})
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let body = ''
		req.on('data', (c) => {
			body += c
			if (body.length > 10_000) req.destroy()
		})
		req.on('end', () => {
			try {
				resolve(body ? JSON.parse(body) : {})
			} catch (e) {
				reject(e)
			}
		})
	})
}

const json = (res, status, data) => {
	res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' })
	res.end(JSON.stringify(data))
}

// Plik tylko z wnętrza `base` – chroni przed ../
function serveFrom(base, rel, res) {
	const file = path.resolve(base, rel)
	if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
		res.writeHead(404).end('Not found')
		return
	}
	res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
	fs.createReadStream(file).pipe(res)
}

async function handle(req, res) {
	const url = new URL(req.url, 'http://localhost')
	const p = decodeURIComponent(url.pathname)

	if (req.method === 'GET' && p === '/api/meta') {
		return json(res, 200, { specs: listSpecs(), baseUrl: defaultBaseUrl() })
	}
	if (req.method === 'GET' && p === '/api/status') {
		return json(res, 200, job)
	}
	if (req.method === 'POST' && p === '/api/run') {
		if (job.running) return json(res, 409, { error: 'Testy już trwają' })
		const body = await readBody(req)
		let baseUrl = ''
		if (body.baseUrl) {
			try {
				const u = new URL(body.baseUrl)
				if (!/^https?:$/.test(u.protocol)) throw new Error()
				baseUrl = u.href
			} catch {
				return json(res, 400, { error: 'Nieprawidłowy adres URL' })
			}
		}
		const available = listSpecs()
		const specs = Array.isArray(body.specs) ? body.specs.filter((s) => available.includes(s)) : []
		const pageSource = ['home', 'crawl', 'sitemap', 'list'].includes(body.pageSource) ? body.pageSource : 'home'
		const maxPages = Math.min(Math.max(Number(body.maxPages) || 10, 1), 100)
		const pageList = typeof body.pageList === 'string' ? body.pageList.slice(0, 5000) : ''
		startRun({ baseUrl, specs, pageSource, maxPages, pageList })
		return json(res, 202, job)
	}
	if (req.method === 'POST' && p === '/api/visual/approve') {
		const { baseUrl, name } = await readBody(req)
		if (!/^[\w-]+$/.test(name ?? '')) return json(res, 400, { error: 'Nieprawidłowa nazwa' })
		const dir = path.join(VISUAL_DIR, hostKey(baseUrl))
		const actual = path.join(dir, 'actual', `${name}.png`)
		if (!fs.existsSync(actual)) return json(res, 404, { error: 'Brak aktualnego zrzutu' })
		fs.mkdirSync(path.join(dir, 'baseline'), { recursive: true })
		fs.copyFileSync(actual, path.join(dir, 'baseline', `${name}.png`))
		fs.rmSync(path.join(dir, 'diff', `${name}.png`), { force: true })
		return json(res, 200, { ok: true })
	}

	if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
	if (p === '/results.json') {
		const file = path.join(DASH_DIR, 'results.json')
		return fs.existsSync(file) ? serveFrom(DASH_DIR, 'results.json', res) : json(res, 200, [])
	}
	if (p.startsWith('/visual/')) return serveFrom(VISUAL_DIR, p.slice('/visual/'.length), res)
	if (p.startsWith('/screenshots/')) return serveFrom(SCREENSHOTS_DIR, p.slice('/screenshots/'.length), res)
	if (p.startsWith('/reports/')) return serveFrom(REPORTS_DIR, p.slice('/reports/'.length), res)
	if (['/', '/index.html', '/app.js', '/style.css'].includes(p)) return serveFrom(DASH_DIR, p === '/' ? 'index.html' : p.slice(1), res)
	res.writeHead(404).end('Not found')
}

http
	.createServer((req, res) =>
		handle(req, res).catch((err) => {
			console.error(err)
			if (!res.headersSent) json(res, 500, { error: err.message })
		})
	)
	.listen(PORT, '127.0.0.1', () => console.log(`Dashboard: http://localhost:${PORT}`))
