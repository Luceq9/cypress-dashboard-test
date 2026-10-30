import { check, describeEl, forEachPage, isVisible, PAGES, report, trackNetwork, waitForNetworkIdle } from '../support/audit'

// Ciasteczka analityczne/marketingowe – nie powinny powstać przed zgodą (RODO, Prawo telekomunikacyjne)
const TRACKING_COOKIES = /^(_ga|_gid|_gat|_gcl_|_fbp|_fbc|fr$|_hj|_clck|_clsk|_uet|_tt_|_ttp|_pin_|_scid|li_|bcookie|IDE$|test_cookie$|NID$|_rdt)/
const TRACKERS: [RegExp, string][] = [
	[/google-analytics\.com|analytics\.google\.com/, 'Google Analytics'],
	[/googletagmanager\.com/, 'Google Tag Manager'],
	[/doubleclick\.net|googleadservices\.com|googlesyndication\.com/, 'Google Ads'],
	[/connect\.facebook\.net|facebook\.com\/tr/, 'Meta Pixel'],
	[/hotjar\.(com|io)/, 'Hotjar'],
	[/clarity\.ms/, 'Microsoft Clarity'],
	[/bat\.bing\.com/, 'Microsoft Ads'],
	[/analytics\.tiktok\.com/, 'TikTok Pixel'],
	[/snap\.licdn\.com|px\.ads\.linkedin\.com/, 'LinkedIn Insight'],
	[/criteo\.(com|net)/, 'Criteo'],
	[/ct\.pinterest\.com/, 'Pinterest Tag'],
]
const BANNER_TEXT = /cookie|ciasteczk|plik(i|ów) cookie|zgod|consent|rodo|gdpr/i
const PRIVACY_LINK = /polityk\w* prywatno|privacy|rodo|cookies/i

describe('Prywatność i zgody (RODO)', () => {
	// Ciasteczka i skrypty dotyczą całej witryny – wystarczy pierwsza strona z listy
	forEachPage('brak śledzenia przed zgodą', (page) => {
		const thirdParty = new Set<string>()
		const trackers = new Set<string>()
		const origin = new URL(Cypress.config('baseUrl')!).origin

		cy.clearAllCookies()
		cy.intercept({ url: /.*/ }, (req) => {
			const u = new URL(req.url)
			if (u.origin === origin) return
			thirdParty.add(u.hostname)
			const hit = TRACKERS.find(([re]) => re.test(req.url))
			if (hit) trackers.add(hit[1])
		})
		trackNetwork()
		cy.visit(page)
		waitForNetworkIdle(1500)

		cy.getAllCookies().then((cookies) => {
			cy.document().then((doc) => {
				const tracking = cookies.filter((c) => TRACKING_COOKIES.test(c.name))
				const banner = [...doc.querySelectorAll('body *')].find((el) => {
					const pos = doc.defaultView!.getComputedStyle(el).position
					return (pos === 'fixed' || pos === 'sticky' || el.getAttribute('role') === 'dialog') && isVisible(el) && BANNER_TEXT.test(el.textContent ?? '')
				})
				const privacyLink = [...doc.querySelectorAll('a[href]')].find((a) => PRIVACY_LINK.test(a.textContent ?? ''))

				report(
					'privacy',
					[
						check('Brak ciasteczek śledzących przed zgodą', tracking.length === 0, {
							value: tracking.length,
							details: tracking.map((c) => `${c.name} (${c.domain})`),
							ref: 'RODO art. 6, 7',
						}),
						check('Brak skryptów śledzących przed zgodą', trackers.size === 0, {
							warnOnly: true,
							value: [...trackers].join(', ') || 'brak',
							ref: 'Google Consent Mode może wysyłać pingi bez ciasteczek – sprawdź konfigurację',
						}),
						check('Widoczny baner zgody na cookies', !!banner, { warnOnly: true, value: banner ? describeEl(banner) : 'nie znaleziono' }),
						check('Link do polityki prywatności / cookies', !!privacyLink, {
							warnOnly: true,
							value: privacyLink ? (privacyLink as HTMLAnchorElement).href : 'brak',
						}),
						check('Ciasteczka ustawione przy wejściu', true, {
							value: cookies.length,
							details: cookies.map((c) => `${c.name} · ${c.domain}${c.secure ? ' · Secure' : ''}${c.httpOnly ? ' · HttpOnly' : ''}`),
						}),
						check('Zewnętrzne domeny ładowane przy wejściu', true, { value: thirdParty.size, details: [...thirdParty].sort() }),
					],
					{ cookies: cookies.map((c) => ({ name: c.name, domain: c.domain, tracking: TRACKING_COOKIES.test(c.name) })), thirdParty: [...thirdParty].sort(), trackers: [...trackers] }
				)
			})
		})
	}, PAGES.slice(0, 1))
})
