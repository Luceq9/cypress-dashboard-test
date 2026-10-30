import { check, describeEl, report } from '../support/audit'

interface HttpResult { status: number; location: string | null; body: string; error?: string }

// Pliki, które nie powinny być publicznie dostępne. `match` odróżnia prawdziwy plik od strony 404 z kodem 200
const EXPOSED = [
	{ path: '/.git/HEAD', match: /^ref:/, critical: true },
	{ path: '/.env', match: /^[A-Z_]+=/m, critical: true },
	{ path: '/wp-config.php.bak', match: /DB_PASSWORD/, critical: true },
	{ path: '/readme.html', match: /WordPress/i, critical: false },
	{ path: '/xmlrpc.php', match: /XML-RPC/i, critical: false },
	{ path: '/wp-json/wp/v2/users', match: /"slug"/, critical: false },
]

describe('Bezpieczeństwo', () => {
	it('HTTPS, nagłówki bezpieczeństwa i brak wystawionych plików', () => {
		const base = new URL(Cypress.config('baseUrl')!)
		const exposed: { path: string; critical: boolean }[] = []

		EXPOSED.forEach((f) =>
			cy.task<HttpResult>('httpCheck', { url: base.origin + f.path }, { log: false }).then((r) => {
				if (r.status === 200 && f.match.test(r.body)) exposed.push(f)
			})
		)

		cy.task<HttpResult>('httpCheck', { url: `http://${base.host}/` }).then((http) => {
			cy.request('/').then((res) => {
				const h = res.headers as Record<string, string | string[] | undefined>
				const get = (k: string) => [h[k]].flat().join('; ')
				const csp = get('content-security-policy')
				const cookies = [h['set-cookie'] ?? []].flat()
				const weakCookies = cookies.filter((c) => !/;\s*secure/i.test(c) || !/;\s*samesite/i.test(c)).map((c) => c.split(';')[0].split('=')[0])
				const leaks = ['server', 'x-powered-by'].filter((k) => /\d/.test(get(k))).map((k) => `${k}: ${get(k)}`)

				cy.visit('/')
				cy.document().then((doc) => {
					const mixed = [...doc.querySelectorAll('img[src^="http:"], script[src^="http:"], link[href^="http:"][rel=stylesheet], iframe[src^="http:"]')]

					report('security', [
						check('Strona działa po HTTPS', base.protocol === 'https:'),
						check('HTTP przekierowuje na HTTPS', http.status >= 300 && http.status < 400 && /^https:/.test(http.location ?? ''), {
							value: http.error ? `błąd: ${http.error}` : `${http.status} → ${http.location ?? '—'}`,
						}),
						check('Strict-Transport-Security (HSTS)', !!get('strict-transport-security'), { warnOnly: true, value: get('strict-transport-security') || 'brak' }),
						check('Content-Security-Policy', !!csp, { warnOnly: true, value: csp ? 'ustawiony' : 'brak' }),
						check('X-Content-Type-Options: nosniff', /nosniff/i.test(get('x-content-type-options')), { warnOnly: true }),
						check('Ochrona przed clickjackingiem', !!get('x-frame-options') || /frame-ancestors/.test(csp), {
							warnOnly: true,
							value: get('x-frame-options') || (/frame-ancestors/.test(csp) ? 'CSP frame-ancestors' : 'brak'),
						}),
						check('Referrer-Policy', !!get('referrer-policy'), { warnOnly: true, value: get('referrer-policy') || 'brak' }),
						check('Permissions-Policy', !!get('permissions-policy'), { warnOnly: true }),
						check('Serwer nie ujawnia wersji oprogramowania', leaks.length === 0, { warnOnly: true, details: leaks }),
						check('Ciasteczka mają Secure i SameSite', weakCookies.length === 0, { warnOnly: true, value: `${cookies.length} ciastek`, details: weakCookies }),
						check('Brak mieszanej treści (http:// na stronie https)', mixed.length === 0, { value: mixed.length, details: mixed.map(describeEl) }),
						check('Brak publicznie dostępnych plików wrażliwych', !exposed.some((f) => f.critical), {
							value: exposed.length,
							details: exposed.map((f) => `${f.critical ? 'KRYTYCZNE' : 'uwaga'}: ${f.path}`),
						}),
						check('Brak ujawniających informacji plików (readme, xmlrpc, users API)', !exposed.some((f) => !f.critical), {
							warnOnly: true,
							details: exposed.filter((f) => !f.critical).map((f) => f.path),
						}),
					])
				})
			})
		})
	})
})
