import { check, describeEl, forEachPage, isVisible, report } from '../support/audit'

const GENERIC_ALT = /^(obraz(ek)?|zdj[eę]cie|grafika|ikona|icon|image|img|photo|picture|foto|logo|miniaturka|thumbnail|banner|baner)$/i
const FILE_ALT = /\.(jpe?g|png|gif|webp|svg|avif)$|^(img|dsc|image)[-_]?\d+/i
const BCP47 = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

const setReducedMotion = (reduce: boolean) =>
	Cypress.automation('remote:debugger:protocol', {
		command: 'Emulation.setEmulatedMedia',
		params: { features: reduce ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [] },
	})

// Kryteria, których axe nie sprawdza: ruch, powiększanie tekstu, jakość tekstów alternatywnych
describe('Dostępność – testy dodatkowe', () => {
	afterEach(() => {
		cy.wrap(setReducedMotion(false), { log: false })
	})

	forEachPage('ruch, powiększenie tekstu 200% i jakość tekstów alternatywnych', (page) => {
		cy.wrap(setReducedMotion(true), { log: false })
		cy.visit(page)
		cy.wait(1000)

		cy.document().then((doc) => {
			const win = doc.defaultView!
			// Animacje, które dalej działają mimo „ogranicz ruch” i trwają > 5 s albo w nieskończoność
			const longAnimations = doc
				.getAnimations()
				.filter((a) => {
					const t = a.effect?.getComputedTiming()
					return a.playState === 'running' && t && (t.iterations === Infinity || Number(t.activeDuration) > 5000)
				})
				.map((a) => {
					const target = (a.effect as KeyframeEffect | null)?.target
					return `${target ? describeEl(target) : '?'} (${(a as CSSAnimation).animationName ?? 'animacja'})`
				})
			const autoplay = [...doc.querySelectorAll<HTMLVideoElement | HTMLAudioElement>('video[autoplay], audio[autoplay]')]
			const autoplaySound = autoplay.filter((m) => !m.muted)
			const autoplayNoControls = autoplay.filter((m) => !m.controls)

			const images = [...doc.images].filter(isVisible)
			const genericAlt = images.filter((i) => GENERIC_ALT.test(i.alt.trim()))
			const fileAlt = images.filter((i) => FILE_ALT.test(i.alt.trim()))
			const longAlt = images.filter((i) => i.alt.length > 150)
			const lang = doc.documentElement.lang
			const badLangParts = [...doc.querySelectorAll('[lang]')].filter((el) => el !== doc.documentElement && !BCP47.test(el.getAttribute('lang') ?? ''))

			// Powiększenie tekstu 200% przez rozmiar czcionki dokumentu (jak ustawienie w przeglądarce)
			const sample = [...doc.querySelectorAll('p, li, a')].find((el) => isVisible(el) && el.textContent?.trim())
			const before = sample ? parseFloat(win.getComputedStyle(sample).fontSize) : 0
			doc.documentElement.style.fontSize = '200%'
			const after = sample ? parseFloat(win.getComputedStyle(sample).fontSize) : 0
			const overflow = doc.documentElement.scrollWidth - win.innerWidth
			doc.documentElement.style.fontSize = ''

			report(
				'a11y-plus',
				[
					check('Animacje respektują „ogranicz ruch”', longAnimations.length === 0, {
						warnOnly: true,
						value: longAnimations.length,
						details: longAnimations,
						ref: 'WCAG 2.2.2, 2.3.3',
					}),
					check('Brak automatycznie odtwarzanego dźwięku', autoplaySound.length === 0, {
						value: autoplaySound.length,
						details: autoplaySound.map(describeEl),
						ref: 'WCAG 1.4.2',
					}),
					check('Autoodtwarzane media mają kontrolki', autoplayNoControls.length === 0, {
						warnOnly: true,
						value: autoplayNoControls.length,
						details: autoplayNoControls.map(describeEl),
						ref: 'WCAG 2.2.2',
					}),
					check('Tekst powiększa się z ustawieniem przeglądarki', !sample || after > before * 1.5, {
						warnOnly: true,
						value: sample ? `${before}px → ${after}px` : 'brak tekstu',
						ref: 'WCAG 1.4.4 – czcionki w px zamiast rem/em nie skalują się',
					}),
					check('Brak poziomego przewijania przy tekście 200%', overflow <= 1, {
						warnOnly: true,
						value: overflow > 1 ? `wystaje ${overflow}px` : 'OK',
						ref: 'WCAG 1.4.4',
					}),
					check('Teksty alt nie są ogólnikami („zdjęcie”, „ikona”)', genericAlt.length === 0, {
						warnOnly: true,
						value: genericAlt.length,
						details: genericAlt.map((i) => `alt="${i.alt}" – ${i.currentSrc || i.src}`),
						ref: 'WCAG 1.1.1',
					}),
					check('Teksty alt nie są nazwami plików', fileAlt.length === 0, {
						value: fileAlt.length,
						details: fileAlt.map((i) => `alt="${i.alt}"`),
						ref: 'WCAG 1.1.1',
					}),
					check('Teksty alt ≤ 150 znaków', longAlt.length === 0, {
						warnOnly: true,
						value: longAlt.length,
						details: longAlt.map((i) => i.alt.slice(0, 80) + '…'),
						ref: 'dłuższy opis → aria-describedby lub tekst obok',
					}),
					check('Poprawny kod języka strony', BCP47.test(lang), { value: lang || 'brak', ref: 'WCAG 3.1.1' }),
					check('Poprawne kody języka fragmentów', badLangParts.length === 0, {
						value: badLangParts.length,
						details: badLangParts.map((el) => `${describeEl(el)} lang="${el.getAttribute('lang')}"`),
						ref: 'WCAG 3.1.2',
					}),
				],
				{ longAnimations, genericAlt: genericAlt.map((i) => i.alt) }
			)
		})
	})
})
