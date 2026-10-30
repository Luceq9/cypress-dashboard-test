// Dashboard audytu – czyta results.json i (przez server.mjs) uruchamia Cypressa

// Klucz = nazwa speca bez numeru: 02-a11y.cy.ts -> a11y
const CATEGORIES = [
	{ key: 'smoke', name: 'Smoke', desc: 'Czy strona odpowiada i renderuje podstawowe elementy (nawigacja, H1, stopka).' },
	{
		key: 'a11y',
		name: 'Dostępność WCAG',
		desc: 'Automatyczny audyt axe-core: WCAG 2.0–2.2, poziomy A i AA oraz dobre praktyki, na desktopie i mobile. Automat wykrywa ok. 30–40% problemów – resztę trzeba sprawdzić ręcznie (lista niżej).',
	},
	{
		key: 'a11y-plus',
		name: 'Dostępność – dodatkowe',
		desc: 'Kryteria, których axe nie sprawdza: animacje przy „ogranicz ruch”, autoodtwarzanie, powiększanie tekstu 200%, jakość tekstów alternatywnych, kody języka.',
	},
	{ key: 'keyboard', name: 'Klawiatura', desc: 'Przejście po stronie klawiszem Tab: skip link, widoczność fokusu, pułapki klawiaturowe, kolejność.' },
	{ key: 'forms', name: 'Formularze', desc: 'Etykiety pól, nazwy przycisków, autocomplete, typy pól i wpisywanie danych.' },
	{ key: 'visual', name: 'Testy wizualne', desc: 'Zrzut całej strony porównany piksel po pikselu ze wzorcem (desktop, tablet, mobile).' },
	{ key: 'responsive', name: 'Responsywność', desc: 'Brak poziomego przewijania od 320 px (WCAG 1.4.10), czytelność tekstu, odporność na zwiększone odstępy (WCAG 1.4.12).' },
	{ key: 'performance', name: 'Wydajność', desc: 'Core Web Vitals (LCP, CLS, FCP, TTFB), waga i liczba zasobów, optymalizacja obrazków.' },
	{
		key: 'lighthouse',
		name: 'Lighthouse',
		desc: 'Audyt Google Lighthouse w osobnym Chrome: wydajność (z symulacją wolnego telefonu), dostępność, dobre praktyki i SEO. Pełny raport HTML dla każdej strony.',
	},
	{ key: 'seo', name: 'SEO', desc: 'Meta tagi, nagłówki, canonical, Open Graph, dane strukturalne, robots.txt i sitemap.' },
	{ key: 'html', name: 'Walidacja HTML', desc: 'Poprawność kodu HTML (html-validate, offline): zduplikowane id, błędne zagnieżdżenia, reguły dostępności WCAG.' },
	{ key: 'links', name: 'Linki', desc: 'Niedziałające linki wewnętrzne i kotwice, nazwy linków, niejasne opisy, bezpieczne otwieranie w nowej karcie.' },
	{ key: 'security', name: 'Bezpieczeństwo', desc: 'HTTPS, nagłówki bezpieczeństwa, ciasteczka, mieszana treść i publicznie wystawione pliki.' },
	{
		key: 'privacy',
		name: 'Prywatność (RODO)',
		desc: 'Co strona robi przed kliknięciem zgody: ciasteczka śledzące, skrypty analityczne i reklamowe, zewnętrzne domeny, baner zgody i polityka prywatności.',
	},
	{ key: 'console', name: 'Błędy strony', desc: 'Wyjątki JavaScript, błędy i ostrzeżenia w konsoli, zasoby zwracające 4xx/5xx.' },
]

const STATUS_TEXT = { pass: 'OK', warn: 'Ostrzeżenia', fail: 'Błędy', none: 'Nie uruchomiono' }
const CHECK_TEXT = { pass: 'OK', warn: 'Uwaga', fail: 'Błąd' }
const IMPACT_TEXT = { critical: 'krytyczne', serious: 'poważne', moderate: 'umiarkowane', minor: 'drobne' }
const RATING_TEXT = { good: 'dobry', 'needs-improvement': 'do poprawy', poor: 'słaby' }
const RATING_STATUS = { good: 'pass', 'needs-improvement': 'warn', poor: 'fail' }

// Rzeczy, których automat nie sprawdzi – dla audytu dostępności muszą zostać zrobione ręcznie
const MANUAL_CHECKS = [
	['Czytnik ekranu (NVDA, VoiceOver)', 'Treść, kolejność czytania i komunikaty mają sens po przeczytaniu na głos.', '1.3.2, 4.1.3'],
	['Sensowne teksty alternatywne', 'Alt opisuje funkcję obrazka, a nie tylko „zdjęcie” czy nazwę pliku.', '1.1.1'],
	['Napisy i transkrypcje', 'Wideo ma napisy, nagrania audio mają transkrypcję.', '1.2.x'],
	['Powiększenie 200% i 400%', 'Przy powiększeniu w przeglądarce nic nie znika ani nie nachodzi na siebie.', '1.4.4, 1.4.10'],
	['Komunikaty błędów formularzy', 'Błędy są opisane tekstem, powiązane z polem i podpowiadają, jak je poprawić.', '3.3.1, 3.3.3'],
	['Treści pojawiające się po najechaniu', 'Tooltipy i menu da się zamknąć klawiszem Esc i nie znikają przy najechaniu na nie.', '1.4.13'],
	['Ruch i animacje', 'Animacje dłuższe niż 5 s można zatrzymać, strona respektuje „ogranicz ruch”.', '2.2.2, 2.3.3'],
	['Limity czasu', 'Użytkownik może wydłużyć lub wyłączyć limity czasu (np. koszyk, sesja).', '2.2.1'],
	['Spójna nawigacja i identyfikacja', 'Menu i ikony działają tak samo na wszystkich podstronach.', '3.2.3, 3.2.4'],
	['Uwierzytelnianie bez zagadek', 'Logowanie nie wymaga przepisywania kodów ani testów poznawczych.', '3.3.8'],
]

const $ = (sel) => document.querySelector(sel)
const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fmtMs = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`)
const fmtDate = (iso) => new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
const plural = (n, one, few, many) => {
	if (n === 1) return `${n} ${one}`
	const d = n % 10, t = n % 100
	return `${n} ${d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many}`
}
const badge = (status, text = STATUS_TEXT[status]) => `<span class="badge s-${status}">${esc(text)}</span>`

const LH_NAMES = { performance: 'Wydajność', accessibility: 'Dostępność', 'best-practices': 'Dobre praktyki', seo: 'SEO' }
const IMPACT_RANK = { critical: 0, serious: 1, moderate: 2, minor: 3 }
const lhStatus = (score) => (score >= 90 ? 'pass' : score >= 50 ? 'warn' : 'fail')

const state = { runs: [], runIndex: 0, api: false, meta: null, pollTimer: null, pageFilter: '' }

// ---------- Dane ----------

const specKey = (spec) => spec.replace(/^.*\//, '').replace(/^\d+-/, '').replace(/\.cy\.\w+$/, '')

function categoryData(run, key) {
	const reports = (run.reports ?? []).filter((r) => r.category === key)
	const tests = run.tests.filter((t) => specKey(t.spec) === key)
	const checks = reports.flatMap((r) => r.checks)
	const counts = { pass: 0, warn: 0, fail: 0 }
	checks.forEach((c) => counts[c.status]++)
	// Test, który padł zanim cokolwiek zgłosił (np. timeout) też liczymy jako błąd
	const crashed = tests.filter((t) => t.state === 'failed' && !reports.some((r) => r.test === t.title))
	counts.fail += crashed.length
	const total = counts.pass + counts.warn + counts.fail
	const status = !tests.length && !reports.length ? 'none' : counts.fail ? 'fail' : counts.warn ? 'warn' : 'pass'
	const score = total ? Math.round(((counts.pass + counts.warn * 0.5) / total) * 100) : null
	return { reports, tests, counts, crashed, status, score }
}

function overall(run) {
	const cats = CATEGORIES.map((c) => categoryData(run, c.key)).filter((d) => d.status !== 'none')
	const scores = cats.map((d) => d.score).filter((s) => s !== null)
	return {
		score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
		fail: cats.reduce((s, d) => s + d.counts.fail, 0),
		warn: cats.reduce((s, d) => s + d.counts.warn, 0),
		pass: cats.reduce((s, d) => s + d.counts.pass, 0),
	}
}

async function loadResults() {
	try {
		const res = await fetch(`results.json?${Date.now()}`)
		state.runs = res.ok ? await res.json() : []
	} catch {
		state.runs = []
	}
	state.runIndex = Math.min(state.runIndex, Math.max(state.runs.length - 1, 0))
	renderRunSelect()
	render()
}

// ---------- Nawigacja ----------

const currentView = () => {
	const key = location.hash.slice(1)
	return key === 'pages' || CATEGORIES.some((c) => c.key === key) ? key : 'overview'
}

const runPages = (run) => run.pages ?? [...new Set((run.reports ?? []).map((r) => r.page ?? '/'))]

function renderNav() {
	const run = state.runs[state.runIndex]
	const view = currentView()
	const item = (href, name, status, count) => `
		<li><a href="#${href}" ${view === href ? 'aria-current="page"' : ''}>
			<span class="dot s-${status}" aria-hidden="true"></span>
			<span class="nav-name">${esc(name)}<span class="visually-hidden">, ${esc(STATUS_TEXT[status])}</span></span>
			${count ? `<span class="nav-count" aria-label="${esc(count)}">${esc(count.split(' ')[0])}</span>` : ''}
		</a></li>`
	const ov = run ? overall(run) : null
	const pageCount = run ? runPages(run).length : 0
	$('#nav-list').innerHTML =
		item('overview', 'Przegląd', ov ? (ov.fail ? 'fail' : ov.warn ? 'warn' : 'pass') : 'none', '') +
		item('pages', 'Podstrony', ov ? (ov.fail ? 'fail' : ov.warn ? 'warn' : 'pass') : 'none', pageCount ? plural(pageCount, 'strona', 'strony', 'stron') : '') +
		CATEGORIES.map((c) => {
			const d = run ? categoryData(run, c.key) : { status: 'none', counts: {} }
			const problems = (d.counts.fail ?? 0) + (d.counts.warn ?? 0)
			return item(c.key, c.name, d.status, problems ? plural(problems, 'problem', 'problemy', 'problemów') : '')
		}).join('')
}

function renderRunSelect() {
	const sel = $('#run-select')
	if (!state.runs.length) {
		sel.innerHTML = '<option>Brak wyników</option>'
		sel.disabled = true
		return
	}
	sel.disabled = false
	sel.innerHTML = state.runs
		.map((r, i) => `<option value="${i}" ${i === state.runIndex ? 'selected' : ''}>${esc(fmtDate(r.startedAt))} – ${esc(r.host ?? r.baseUrl)} (${r.totals.passed}/${r.totals.tests})</option>`)
		.join('')
}

// ---------- Widoki ----------

function render() {
	renderNav()
	const run = state.runs[state.runIndex]
	const view = currentView()
	const el = $('#view')
	if (!run) {
		el.innerHTML = `<section class="panel empty"><h2>Brak wyników</h2><p>Uruchom testy przyciskiem powyżej albo poleceniem <code>npm test</code>.</p></section>`
		return
	}
	el.innerHTML =
		view === 'overview' ? renderOverview(run) : view === 'pages' ? renderPages(run) : renderCategory(run, CATEGORIES.find((c) => c.key === view))
}

// Macierz: każda podstrona × każda kategoria + duplikaty tytułów/opisów + wyniki Lighthouse
function renderPages(run) {
	const pages = runPages(run)
	const cats = CATEGORIES.filter((c) => (run.reports ?? []).some((r) => r.category === c.key))
	const cell = (page, cat) => {
		const reports = run.reports.filter((r) => r.category === cat.key && (r.page ?? '/') === page)
		if (!reports.length) return '<td class="num"><span class="ref">–</span></td>'
		const checks = reports.flatMap((r) => r.checks)
		const fail = checks.filter((c) => c.status === 'fail').length
		const warn = checks.filter((c) => c.status === 'warn').length
		const status = fail ? 'fail' : warn ? 'warn' : 'pass'
		const text = fail ? `${fail} bł.` : warn ? `${warn} ostrz.` : 'OK'
		return `<td><a href="#${cat.key}" data-page="${esc(page)}" class="cell-link">${badge(status, text)}<span class="visually-hidden"> – ${esc(cat.name)}, ${esc(page)}</span></a></td>`
	}

	const seo = (run.reports ?? []).filter((r) => r.category === 'seo' && r.extra)
	const dupes = (key) => {
		const groups = {}
		seo.forEach((r) => {
			const v = (r.extra[key] ?? '').trim()
			if (v) (groups[v] ??= []).push(r.page)
		})
		return Object.entries(groups).filter(([, p]) => p.length > 1)
	}
	const dupTitles = dupes('title')
	const dupDescs = dupes('description')
	const noDesc = seo.filter((r) => !r.extra.description).map((r) => r.page)

	const lh = (run.reports ?? []).filter((r) => r.category === 'lighthouse' && r.extra?.scores)

	return `
	<section class="section" aria-labelledby="pages-h">
		<h2 id="pages-h">Podstrony</h2>
		<p class="lead">Zakres: <strong>${esc({ home: 'tylko strona główna', crawl: 'linki ze strony głównej', sitemap: 'mapa strony (sitemap)', list: 'własna lista' }[run.pageSource] ?? 'strona główna')}</strong> · ${plural(pages.length, 'strona', 'strony', 'stron')}. Kliknij komórkę, aby zobaczyć szczegóły tej kategorii dla danej strony.</p>
		<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela: Wyniki podstron według kategorii"><table class="matrix">
			<thead><tr><th scope="col">Strona</th>${cats.map((c) => `<th scope="col">${esc(c.name)}</th>`).join('')}</tr></thead>
			<tbody>${pages.map((p) => `<tr><th scope="row"><a href="${esc(new URL(p, run.baseUrl).href)}" target="_blank" rel="noopener"><code>${esc(p)}</code><span class="visually-hidden"> (otwiera stronę w nowej karcie)</span></a></th>${cats.map((c) => cell(p, c)).join('')}</tr>`).join('')}</tbody>
		</table></div>
	</section>

	${lh.length ? `<section class="section" aria-labelledby="pages-lh">
		<h3 id="pages-lh">Lighthouse – wyniki stron</h3>
		${renderLighthouseTable(lh)}
	</section>` : ''}

	${seo.length > 1 ? `<section class="section" aria-labelledby="pages-dup">
		<h3 id="pages-dup">Duplikaty treści SEO</h3>
		${!dupTitles.length && !dupDescs.length && !noDesc.length ? `<p>${badge('pass', 'Każda strona ma unikalny tytuł i opis')}</p>` : `
		<ul class="dup-list">
			${dupTitles.map(([t, p]) => `<li>${badge('warn', 'Ten sam tytuł')} „${esc(t)}” – ${p.map((x) => `<code>${esc(x)}</code>`).join(', ')}</li>`).join('')}
			${dupDescs.map(([t, p]) => `<li>${badge('warn', 'Ten sam opis')} „${esc(t.slice(0, 90))}…” – ${p.map((x) => `<code>${esc(x)}</code>`).join(', ')}</li>`).join('')}
			${noDesc.length ? `<li>${badge('fail', 'Brak meta description')} ${noDesc.map((x) => `<code>${esc(x)}</code>`).join(', ')}</li>` : ''}
		</ul>`}
	</section>` : ''}`
}

function renderLighthouseTable(reports) {
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela: Wyniki Lighthouse"><table>
		<thead><tr><th scope="col">Strona</th><th scope="col">Urządzenie</th>${Object.values(LH_NAMES).map((n) => `<th scope="col" class="num">${n}</th>`).join('')}<th scope="col">Raport</th></tr></thead>
		<tbody>${reports.map((r) => `<tr>
			<td><code>${esc(r.page)}</code></td>
			<td>${r.extra.formFactor === 'desktop' ? 'Desktop' : 'Telefon'}</td>
			${Object.keys(LH_NAMES).map((k) => `<td class="num">${r.extra.scores[k] !== undefined ? badge(lhStatus(r.extra.scores[k]), String(r.extra.scores[k])) : '–'}</td>`).join('')}
			<td><a href="${esc(r.extra.reportUrl)}" target="_blank" rel="noopener">Pełny raport<span class="visually-hidden"> Lighthouse dla ${esc(r.page)}, ${esc(r.extra.formFactor)} (nowa karta)</span></a></td>
		</tr>`).join('')}</tbody>
	</table></div>`
}

function renderLighthouse(d) {
	const reports = d.reports.filter((r) => r.extra?.scores)
	if (!reports.length) return ''
	return `<section class="section" aria-labelledby="lh-h">
		<h3 id="lh-h">Wyniki</h3>
		${renderLighthouseTable(reports)}
		<p class="ref">≥ 90 dobry · 50–89 do poprawy · &lt; 50 słaby. Wydajność „Telefon” to symulacja średniej klasy telefonu na wolnym 4G – jest celowo surowa.</p>
	</section>
	<section class="section" aria-labelledby="lh-fail-h">
		<h3 id="lh-fail-h">Co poprawić</h3>
		<ul class="violations" role="list">${reports.map((r) => `<li><details class="violation">
			<summary>
				<span class="title"><code>${esc(r.page)}</code> · ${r.extra.formFactor === 'desktop' ? 'Desktop' : 'Telefon'}</span>
				<span class="ref">${plural(r.extra.failing.length, 'problem', 'problemy', 'problemów')}</span>
			</summary>
			<div class="body">
				${Object.keys(LH_NAMES).map((cat) => {
					const items = r.extra.failing.filter((f) => f.category === cat)
					return items.length ? `<h4>${LH_NAMES[cat]}</h4><ul>${items.map((f) => `<li>${badge(lhStatus(f.score), String(f.score))} ${esc(f.title)}${f.displayValue ? ` <span class="ref">${esc(f.displayValue)}</span>` : ''}</li>`).join('')}</ul>` : ''
				}).join('')}
				<p><a href="${esc(r.extra.reportUrl)}" target="_blank" rel="noopener">Otwórz pełny raport Lighthouse<span class="visually-hidden"> (nowa karta)</span></a></p>
			</div>
		</details></li>`).join('')}</ul>
	</section>`
}

// Ta sama reguła axe na wielu stronach = zwykle jeden komponent (menu, stopka) do poprawy raz
function renderA11ySummary(d) {
	const rules = {}
	d.reports.forEach((r) =>
		(r.extra?.violations ?? []).forEach((v) => {
			const e = (rules[v.id] ??= { ...v, pages: new Set(), total: 0 })
			e.pages.add(r.page ?? '/')
			e.total += v.nodeCount
		})
	)
	const list = Object.values(rules).sort((a, b) => (IMPACT_RANK[a.impact] ?? 9) - (IMPACT_RANK[b.impact] ?? 9) || b.pages.size - a.pages.size)
	if (!list.length) return ''
	return `<section class="section" aria-labelledby="ax-sum-h">
		<h3 id="ax-sum-h">Naruszenia na wszystkich stronach</h3>
		<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela: Zbiorcze naruszenia WCAG"><table>
			<thead><tr><th scope="col">Waga</th><th scope="col">Problem</th><th scope="col">WCAG</th><th scope="col" class="num">Strony</th><th scope="col" class="num">Elementy</th></tr></thead>
			<tbody>${list.map((v) => `<tr>
				<td><span class="badge impact-${esc(v.impact)}">${esc(IMPACT_TEXT[v.impact] ?? v.impact)}</span></td>
				<td>${esc(v.help)} <a href="${esc(v.helpUrl)}" target="_blank" rel="noopener" class="ref">${esc(v.id)}<span class="visually-hidden"> – opis reguły (nowa karta)</span></a></td>
				<td class="ref">${v.wcag.length ? esc(v.wcag.join(', ')) : 'dobra praktyka'}</td>
				<td class="num">${v.pages.size}</td><td class="num">${v.total}</td>
			</tr>`).join('')}</tbody>
		</table></div>
	</section>`
}

function renderOverview(run) {
	const ov = overall(run)
	const t = run.totals
	const top = CATEGORIES.flatMap((c) =>
		categoryData(run, c.key).reports.flatMap((r) => r.checks.filter((ch) => ch.status === 'fail').map((ch) => ({ ...ch, cat: c, page: r.page ?? '/' })))
	).slice(0, 20)
	const pages = runPages(run)

	return `
	<section class="section" aria-labelledby="sum-h">
		<h2 id="sum-h">Przegląd</h2>
		<p class="lead">${esc(run.baseUrl)} · ${esc(fmtDate(run.startedAt))} · ${esc(run.browser)}</p>
		<dl class="tiles">
			<div class="tile"><dt>Wynik ogólny</dt><dd>${ov.score ?? '–'}${ov.score !== null ? '%' : ''}</dd></div>
			<div class="tile"><dt>Testy zaliczone</dt><dd>${t.passed}/${t.tests}</dd></div>
			<div class="tile"><dt>Podstrony</dt><dd><a href="#pages">${pages.length}<span class="visually-hidden"> – zobacz podstrony</span></a></dd></div>
			<div class="tile"><dt>Błędy</dt><dd class="s-fail" style="background:none">${ov.fail}</dd></div>
			<div class="tile"><dt>Ostrzeżenia</dt><dd class="s-warn" style="background:none">${ov.warn}</dd></div>
			<div class="tile"><dt>Czas trwania</dt><dd>${fmtMs(run.duration)}</dd></div>
		</dl>
	</section>

	<section class="section" aria-labelledby="cat-h">
		<h2 id="cat-h">Kategorie</h2>
		<ul class="cards" role="list">
			${CATEGORIES.map((c) => {
				const d = categoryData(run, c.key)
				return `<li><a class="card" href="#${c.key}">
					<span class="card-top"><h3>${esc(c.name)}</h3>${badge(d.status)}</span>
					<span class="score">${d.score ?? '–'}${d.score !== null ? '%' : ''}</span>
					<span class="meter" aria-hidden="true"><span style="width:${d.score ?? 0}%"></span></span>
					<span class="meta">${d.status === 'none' ? 'Nie uruchomiono w tym przebiegu' : `${d.counts.fail} błędów · ${d.counts.warn} ostrzeżeń · ${d.counts.pass} OK`}</span>
				</a></li>`
			}).join('')}
		</ul>
	</section>

	<section class="section" aria-labelledby="top-h">
		<h2 id="top-h">Najważniejsze błędy</h2>
		${top.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela: Najważniejsze błędy"><table>
			<thead><tr><th scope="col">Kategoria</th><th scope="col">Strona</th><th scope="col">Problem</th><th scope="col">Wartość</th></tr></thead>
			<tbody>${top.map((c) => `<tr><td><a href="#${c.cat.key}" data-page="${esc(c.page)}">${esc(c.cat.name)}</a></td><td><code>${esc(c.page)}</code></td><td>${esc(c.label)}${c.ref ? `<div class="ref">${renderRef(c.ref)}</div>` : ''}</td><td>${esc(c.value ?? '')}</td></tr>`).join('')}</tbody>
		</table></div>` : `<p>${badge('pass', 'Brak błędów')}</p>`}
	</section>

	<section class="section" aria-labelledby="tests-h">
		<h2 id="tests-h">Testy w tym uruchomieniu</h2>
		${renderTestsTable(run.tests)}
	</section>

	<section class="section" aria-labelledby="hist-h">
		<h2 id="hist-h">Historia uruchomień</h2>
		<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela: Historia uruchomień"><table>
			<thead><tr><th scope="col">Data</th><th scope="col">Strona</th><th scope="col" class="num">Testy OK</th><th scope="col" class="num">Wynik</th><th scope="col" class="num">Naruszenia WCAG</th><th scope="col"><span class="visually-hidden">Akcja</span></th></tr></thead>
			<tbody>${state.runs.map((r, i) => {
				const o = overall(r)
				const a11y = (r.reports ?? []).filter((x) => x.category === 'a11y').reduce((s, x) => s + (x.extra?.violations?.filter((v) => v.wcag.length).length ?? 0), 0)
				return `<tr>
					<td>${esc(fmtDate(r.startedAt))}</td><td>${esc(r.host ?? r.baseUrl)}</td>
					<td class="num">${badge(r.totals.failed ? 'fail' : 'pass', `${r.totals.passed}/${r.totals.tests}`)}</td>
					<td class="num">${o.score ?? '–'}%</td><td class="num">${a11y}</td>
					<td>${i === state.runIndex ? '<span class="ref">wyświetlane</span>' : `<button type="button" class="link-button" data-run="${i}">Pokaż<span class="visually-hidden"> uruchomienie z ${esc(fmtDate(r.startedAt))}</span></button>`}</td>
				</tr>`
			}).join('')}</tbody>
		</table></div>
	</section>`
}

function renderTestsTable(tests) {
	if (!tests.length) return '<p>Brak testów.</p>'
	const latest = state.runIndex === 0
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela: Lista testów"><table>
		<thead><tr><th scope="col">Status</th><th scope="col">Test</th><th scope="col" class="num">Czas</th></tr></thead>
		<tbody>${tests.map((t) => `<tr>
			<td>${badge(t.state === 'passed' ? 'pass' : t.state === 'failed' ? 'fail' : 'none', t.state === 'passed' ? 'Zaliczony' : t.state === 'failed' ? 'Niezaliczony' : 'Pominięty')}</td>
			<td>${esc(t.title)}<div class="ref">${esc(t.spec)}</div>
				${t.error ? `<details><summary>Szczegóły błędu</summary><pre class="err">${esc(t.error)}</pre>${t.screenshot && latest ? `<a href="${esc(t.screenshot)}" target="_blank" rel="noopener">Zrzut ekranu z błędu<span class="visually-hidden"> (otwiera się w nowej karcie)</span></a>` : ''}</details>` : ''}
			</td>
			<td class="num">${fmtMs(t.duration)}</td>
		</tr>`).join('')}</tbody>
	</table></div>`
}

const renderRef = (ref) =>
	/^https?:\/\//.test(ref) ? `<a href="${esc(ref)}" target="_blank" rel="noopener">opis reguły<span class="visually-hidden"> (nowa karta)</span></a>` : esc(ref)

function renderChecks(checks, caption) {
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela: Sprawdzenia: ${esc(caption)}"><table>
		<caption>${esc(caption)}</caption>
		<thead><tr><th scope="col">Status</th><th scope="col">Sprawdzenie</th><th scope="col">Wynik</th></tr></thead>
		<tbody>${checks.map((c) => `<tr>
			<td>${badge(c.status, CHECK_TEXT[c.status])}</td>
			<td>${esc(c.label)}${c.ref ? `<div class="ref">${renderRef(c.ref)}</div>` : ''}</td>
			<td>${esc(c.value ?? '')}
				${c.details?.length ? `<details><summary>${plural(c.details.length, 'pozycja', 'pozycje', 'pozycji')}</summary><ul>${c.details.map((d) => `<li><code>${esc(d)}</code></li>`).join('')}</ul></details>` : ''}
			</td>
		</tr>`).join('')}</tbody>
	</table></div>`
}

function renderCategory(run, cat) {
	const all = categoryData(run, cat.key)
	const pages = [...new Set(all.reports.map((r) => r.page ?? '/'))]
	if (!pages.includes(state.pageFilter)) state.pageFilter = ''
	// Filtr podstrony zawęża wszystko poniżej kafelków
	const d = state.pageFilter ? { ...all, reports: all.reports.filter((r) => (r.page ?? '/') === state.pageFilter) } : all
	const extra = {
		a11y: renderA11y,
		visual: renderVisual,
		performance: renderPerformance,
		keyboard: renderKeyboard,
		forms: renderForms,
		lighthouse: renderLighthouse,
	}[cat.key]

	return `
	<section class="section" aria-labelledby="cat-title">
		<h2 id="cat-title">${esc(cat.name)} ${badge(all.status)}</h2>
		<p class="lead">${esc(cat.desc)}</p>
		${all.status === 'none' ? '<p class="note">Ta kategoria nie była uruchomiona w wybranym przebiegu.</p>' : `
		<dl class="tiles">
			<div class="tile"><dt>Wynik</dt><dd>${all.score ?? '–'}${all.score !== null ? '%' : ''}</dd></div>
			<div class="tile"><dt>Błędy</dt><dd>${all.counts.fail}</dd></div>
			<div class="tile"><dt>Ostrzeżenia</dt><dd>${all.counts.warn}</dd></div>
			<div class="tile"><dt>Zaliczone</dt><dd>${all.counts.pass}</dd></div>
			<div class="tile"><dt>Podstrony</dt><dd>${pages.length}</dd></div>
		</dl>`}
		${pages.length > 1 ? `<div class="field page-filter">
			<label for="page-filter">Pokaż wyniki dla podstrony</label>
			<select id="page-filter">
				<option value="">Wszystkie (${pages.length})</option>
				${pages.map((p) => `<option value="${esc(p)}" ${p === state.pageFilter ? 'selected' : ''}>${esc(p)}</option>`).join('')}
			</select>
		</div>` : ''}
	</section>
	${cat.key === 'a11y' && !state.pageFilter && pages.length > 1 ? renderA11ySummary(d) : ''}
	${extra ? extra(d, run) : ''}
	${d.reports.length ? `<h3 class="section-title">Wszystkie sprawdzenia</h3>` : ""}
	${d.reports.map((r) => `<section class="section">${renderChecks(r.checks, r.test.split(' › ').slice(1).join(' › ') || r.test)}</section>`).join('')}
	${d.crashed.length ? `<section class="section" aria-labelledby="crash-h"><h3 id="crash-h">Testy przerwane przed raportem</h3>${renderTestsTable(d.crashed)}</section>` : ''}
	${cat.key === 'a11y' ? renderManual() : ''}`
}

function renderA11y(d) {
	return d.reports
		.map((r, i) => {
			const e = r.extra ?? {}
			const byImpact = Object.keys(IMPACT_TEXT).map((k) => [k, e.violations?.filter((v) => v.impact === k).length ?? 0])
			const violation = (v) => `<li><details class="violation">
				<summary>
					<span class="badge impact-${esc(v.impact)}">${esc(IMPACT_TEXT[v.impact] ?? v.impact)}</span>
					<span class="title">${esc(v.help)}</span>
					<span class="ref">${v.wcag.length ? `WCAG ${esc(v.wcag.join(', '))}` : 'dobra praktyka'} · ${plural(v.nodeCount, 'element', 'elementy', 'elementów')}</span>
				</summary>
				<div class="body">
					<p>${esc(v.description)} <a href="${esc(v.helpUrl)}" target="_blank" rel="noopener">Jak to naprawić (reguła ${esc(v.id)})<span class="visually-hidden"> – otwiera się w nowej karcie</span></a></p>
					<ul class="nodes">${v.nodes.map((n) => `<li><code>${esc(n.target)}</code><pre>${esc(n.html)}</pre>${n.summary ? `<pre>${esc(n.summary)}</pre>` : ''}</li>`).join('')}</ul>
					${v.nodeCount > v.nodes.length ? `<p class="ref">Pokazano ${v.nodes.length} z ${v.nodeCount} elementów.</p>` : ''}
				</div>
			</details></li>`
			return `<section class="section" aria-labelledby="ax-${i}">
				<h3 id="ax-${i}">Naruszenia – <code>${esc(r.page ?? '/')}</code> · ${esc(e.viewport)}</h3>
				<p>${byImpact.map(([k, n]) => `<span class="badge impact-${k}">${n} ${IMPACT_TEXT[k]}</span>`).join(' ')} <span class="ref">· ${e.passes ?? 0} reguł zaliczonych</span></p>
				${e.violations?.length ? `<ul class="violations" role="list">${e.violations.map(violation).join('')}</ul>` : `<p>${badge('pass', 'Brak naruszeń')}</p>`}
				${e.incomplete?.length ? `<h4>Do ręcznej weryfikacji (${e.incomplete.length})</h4><ul class="violations" role="list">${e.incomplete.map(violation).join('')}</ul>` : ''}
			</section>`
		})
		.join('')
}

function renderManual() {
	return `<section class="section" aria-labelledby="manual-h">
		<h3 id="manual-h">Do sprawdzenia ręcznie</h3>
		<p class="lead">Tych kryteriów automat nie oceni wiarygodnie. Lista do audytu eksperckiego.</p>
		<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela: Lista do ręcznego sprawdzenia"><table>
			<thead><tr><th scope="col">Obszar</th><th scope="col">Co sprawdzić</th><th scope="col">WCAG</th></tr></thead>
			<tbody>${MANUAL_CHECKS.map(([a, b, c]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td><td class="ref">${esc(c)}</td></tr>`).join('')}</tbody>
		</table></div>
	</section>`
}

function renderVisual(d, run) {
	const canApprove = state.api && state.runIndex === 0
	const bust = encodeURIComponent(run.startedAt)
	return d.reports
		.map((r, i) => {
			const e = r.extra ?? {}
			if (!e.urls) return ''
			const status = e.status === 'changed' ? 'fail' : 'pass'
			const label = e.status === 'new' ? 'Nowy wzorzec' : e.status === 'changed' ? `Zmiana ${(e.diffRatio * 100).toFixed(2)}%` : `Zgodny (${(e.diffRatio * 100).toFixed(2)}%)`
			const shot = (key, title) => `<figure>
				<figcaption>${title}</figcaption>
				<div class="shot-frame" tabindex="0" role="region" aria-label="${title}: ${esc(r.page ?? "/")}, ${esc(e.viewport)} – przewijany obszar">
					<a href="${esc(e.urls[key])}?v=${bust}" target="_blank" rel="noopener"><img src="${esc(e.urls[key])}?v=${bust}" loading="lazy" alt="${title} strony w widoku ${esc(e.viewport)} (otwiera pełny rozmiar w nowej karcie)"></a>
				</div>
			</figure>`
			return `<section class="section panel" aria-labelledby="vis-${i}">
				<div class="visual-head">
					<h3 id="vis-${i}"><code>${esc(r.page ?? '/')}</code> · ${esc(e.viewport)} · ${esc(e.size)}</h3>
					${badge(status, label)}
					${canApprove && e.status === 'changed' ? `<button type="button" class="secondary" data-approve="${esc(e.name)}" data-base="${esc(run.baseUrl)}">Zatwierdź jako nowy wzorzec<span class="visually-hidden"> dla ${esc(e.viewport)}</span></button>` : ''}
				</div>
				${e.actualSize !== e.baselineSize ? `<p class="note">Zmienił się rozmiar strony: ${esc(e.baselineSize)} → ${esc(e.actualSize)}</p>` : ''}
				<div class="shots">
					${shot('baseline', 'Wzorzec')}
					${shot('actual', 'Aktualny')}
					${e.status !== 'new' ? shot('diff', 'Różnice') : ''}
				</div>
			</section>`
		})
		.join('')
}

function renderPerformance(d) {
	const withMetrics = d.reports.filter((r) => r.extra?.metrics)
	if (!withMetrics.length) return ''
	// Wiele stron: tabela strona × metryka; jedna strona: szczegóły zasobów
	if (withMetrics.length > 1) {
		const keys = withMetrics[0].extra.metrics
		return `<section class="section" aria-labelledby="perf-h">
			<h3 id="perf-h">Metryki stron</h3>
			<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela: Metryki wydajności stron"><table>
				<thead><tr><th scope="col">Strona</th>${keys.map((m) => `<th scope="col" class="num">${esc(m.key.toUpperCase())}</th>`).join('')}</tr></thead>
				<tbody>${withMetrics.map((r) => `<tr><td><code>${esc(r.page)}</code></td>${r.extra.metrics.map((m) => `<td class="num">${badge(RATING_STATUS[m.rating], `${m.value}${m.unit ? ' ' + m.unit : ''}`)}</td>`).join('')}</tr>`).join('')}</tbody>
			</table></div>
			<p class="ref">Wybierz podstronę w filtrze powyżej, aby zobaczyć listę jej zasobów.</p>
		</section>`
	}
	const e = withMetrics[0].extra
	return `<section class="section" aria-labelledby="perf-h">
		<h3 id="perf-h">Metryki</h3>
		<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela: Metryki wydajności"><table>
			<thead><tr><th scope="col">Metryka</th><th scope="col" class="num">Wartość</th><th scope="col" class="num">Dobry ≤</th><th scope="col" class="num">Słaby &gt;</th><th scope="col">Ocena</th></tr></thead>
			<tbody>${e.metrics.map((m) => `<tr>
				<td>${esc(m.label)}</td><td class="num">${m.value} ${esc(m.unit)}</td><td class="num">${m.good}</td><td class="num">${m.poor}</td>
				<td>${badge(RATING_STATUS[m.rating], RATING_TEXT[m.rating])}</td>
			</tr>`).join('')}</tbody>
		</table></div>
		<p class="ref">Pomiar w przeglądarce testowej, bez dławienia sieci – realni użytkownicy na telefonach mają gorsze wyniki (zobacz Lighthouse).</p>
	</section>
	<section class="section" aria-labelledby="res-h">
		<h3 id="res-h">Zasoby</h3>
		<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela: Zasoby według typu"><table>
			<caption>Według typu</caption>
			<thead><tr><th scope="col">Typ</th><th scope="col" class="num">Liczba</th><th scope="col" class="num">KB</th></tr></thead>
			<tbody>${e.byType.sort((a, b) => b.kb - a.kb).map((t) => `<tr><td>${esc(t.type)}</td><td class="num">${t.count}</td><td class="num">${t.kb}</td></tr>`).join('')}</tbody>
		</table></div>
		<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela: Największe pliki" style="margin-top:12px"><table>
			<caption>Największe pliki</caption>
			<thead><tr><th scope="col">Adres</th><th scope="col" class="num">KB</th></tr></thead>
			<tbody>${e.largest.map((r) => `<tr><td><code>${esc(r.url)}</code></td><td class="num">${r.kb}</td></tr>`).join('')}</tbody>
		</table></div>
	</section>`
}

// Przy wielu stronach szczegóły zwijamy, żeby lista nie zajmowała kilku ekranów
const perPage = (d, title, body) => {
	const items = d.reports.filter((r) => body(r))
	if (!items.length) return ''
	const single = items.length === 1
	return `<section class="section" aria-labelledby="pp-h">
		<h3 id="pp-h">${title}</h3>
		${items.map((r) => (single ? body(r) : `<details class="violation"><summary><span class="title"><code>${esc(r.page ?? '/')}</code></span></summary><div class="body">${body(r)}</div></details>`)).join('')}
	</section>`
}

function renderKeyboard(d) {
	return perPage(d, 'Kolejność fokusu (Tab)', (r) => {
		const steps = r.extra?.steps
		if (!steps?.length) return ''
		return `<ol class="steps">${steps.map((s) => `<li><code>${esc(s.el)}</code> ${!s.visible ? badge('fail', 'niewidoczny') : !s.indicator ? badge('fail', 'brak wskaźnika') : ''}</li>`).join('')}</ol>`
	})
}

function renderForms(d) {
	return perPage(d, 'Pola formularzy', (r) => {
		const fields = r.extra?.fields
		if (!fields?.length) return ''
		return `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela: Pola formularzy – ${esc(r.page ?? '/')}"><table>
			<thead><tr><th scope="col">Element</th><th scope="col">Typ</th><th scope="col">Etykieta</th><th scope="col">Wymagane</th></tr></thead>
			<tbody>${fields.map((f) => `<tr><td><code>${esc(f.el)}</code></td><td>${esc(f.type)}</td><td>${f.label ? esc(f.label) : badge('fail', 'brak')}</td><td>${f.required ? 'tak' : 'nie'}</td></tr>`).join('')}</tbody>
		</table></div>`
	})
}

// ---------- Uruchamianie testów ----------

async function initRunner() {
	try {
		const res = await fetch('/api/meta')
		if (!res.ok) throw new Error()
		state.meta = await res.json()
		state.api = true
	} catch {
		$('#api-missing').hidden = false
		$('#run-form').hidden = true
		return
	}
	$('#base-url').value = state.meta.baseUrl
	$('#spec-list').innerHTML = state.meta.specs
		.map((spec) => {
			const cat = CATEGORIES.find((c) => c.key === specKey(spec))
			return `<label><input type="checkbox" name="specs" value="${esc(spec)}" checked> ${esc(cat?.name ?? spec)}</label>`
		})
		.join('')
	pollStatus()
}

async function pollStatus() {
	clearTimeout(state.pollTimer)
	const job = await (await fetch('/api/status')).json()
	const button = $('#run-button')
	const progress = $('#run-progress')
	const log = $('#run-log')
	const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20
	log.textContent = job.log || 'Brak logu.'
	if (atBottom) log.scrollTop = log.scrollHeight

	button.disabled = job.running
	$('#run-form').setAttribute('aria-busy', String(job.running))
	if (job.running) {
		// "Running:  02-a11y.cy.ts   (2 of 11)"
		const m = [...job.log.matchAll(/Running:\s+(\S+)\s+\((\d+) of (\d+)\)/g)].pop()
		progress.hidden = false
		if (m) {
			progress.max = Number(m[3])
			progress.value = Number(m[2]) - 1
		}
		const elapsed = fmtMs(Date.now() - new Date(job.startedAt).getTime())
		setStatus(m ? `Trwa: ${m[1]} (${m[2]} z ${m[3]}) · ${elapsed}` : `Uruchamianie Cypressa… ${elapsed}`, false)
		state.pollTimer = setTimeout(pollStatus, 1500)
	} else {
		progress.hidden = true
		if (state.wasRunning) {
			state.runIndex = 0
			await loadResults()
			const run = state.runs[0]
			setStatus(run ? `Zakończono. Zaliczone testy: ${run.totals.passed} z ${run.totals.tests}.` : `Zakończono z kodem ${job.exitCode}.`, true)
		}
	}
	state.wasRunning = job.running
}

// Postęp aktualizujemy po cichu, czytnik ekranu (role=status) dostaje tylko start, koniec i błędy
function setStatus(text, announce) {
	$('#run-progress-text').textContent = text
	if (announce) $('#run-status').textContent = text
}

$('#run-form').addEventListener('submit', async (e) => {
	e.preventDefault()
	const specs = [...document.querySelectorAll('input[name=specs]:checked')].map((i) => i.value)
	if (!specs.length) {
		setStatus('Zaznacz co najmniej jedną kategorię testów.', true)
		return
	}
	const res = await fetch('/api/run', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			baseUrl: $('#base-url').value,
			specs,
			pageSource: document.querySelector('input[name=pageSource]:checked').value,
			maxPages: Number($('#max-pages').value),
			pageList: $('#page-list').value,
		}),
	})
	if (!res.ok) {
		setStatus((await res.json()).error ?? 'Nie udało się uruchomić testów.', true)
		return
	}
	setStatus(`Uruchomiono ${plural(specs.length, 'kategorię', 'kategorie', 'kategorii')} testów.`, true)
	pollStatus()
})

// Pole listy adresów ma sens tylko przy „własna lista”, limit stron – przy crawl/sitemap
function syncPageSource() {
	const source = document.querySelector('input[name=pageSource]:checked').value
	$('#page-list-field').hidden = source !== 'list'
	$('#max-pages-field').hidden = source === 'home' || source === 'list'
}
document.querySelectorAll('input[name=pageSource]').forEach((i) => i.addEventListener('change', syncPageSource))
syncPageSource()

document.querySelector('.spec-actions').addEventListener('click', (e) => {
	const mode = e.target.closest('[data-select]')?.dataset.select
	if (mode) document.querySelectorAll('input[name=specs]').forEach((i) => (i.checked = mode === 'all'))
})

// ---------- Zdarzenia ----------

$('#run-select').addEventListener('change', (e) => {
	state.runIndex = Number(e.target.value)
	render()
})

$('#view').addEventListener('change', (e) => {
	if (e.target.id !== 'page-filter') return
	state.pageFilter = e.target.value
	render()
	$('#page-filter')?.focus()
})

$('#view').addEventListener('click', async (e) => {
	// Link do kategorii z konkretnej strony (macierz podstron, lista błędów) – ustawia filtr
	const pageLink = e.target.closest('a[data-page]')
	if (pageLink) {
		state.pageFilter = pageLink.dataset.page
		state.keepFilter = true
	}
	const runBtn = e.target.closest('[data-run]')
	if (runBtn) {
		state.runIndex = Number(runBtn.dataset.run)
		renderRunSelect()
		render()
		const h = $('#sum-h')
		if (h) {
			h.tabIndex = -1
			h.focus()
		}
		return
	}
	const approve = e.target.closest('[data-approve]')
	if (approve) {
		approve.disabled = true
		const res = await fetch('/api/visual/approve', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: approve.dataset.approve, baseUrl: approve.dataset.base }),
		})
		approve.textContent = res.ok ? 'Zatwierdzono – kolejne uruchomienie porówna z nowym wzorcem' : 'Nie udało się zatwierdzić'
	}
})

window.addEventListener('hashchange', (e) => {
	// Zwykła nawigacja z menu pokazuje wszystkie strony; filtr zostaje tylko po kliknięciu w konkretną stronę
	if (!state.keepFilter) state.pageFilter = ''
	state.keepFilter = false
	render()
	// Po zmianie widoku przenosimy fokus na nagłówek, żeby czytnik ekranu wiedział, gdzie jest
	const h = document.querySelector('#view h2')
	if (h) {
		h.tabIndex = -1
		h.focus()
	}
})

renderNav()
loadResults()
initRunner()
