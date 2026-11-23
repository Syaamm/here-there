const APP_URL = "https://app.example.com";

const COPY = {
  en: {
    skip:"Skip to content",
    "nav.how":"How it works","nav.safety":"Safety","nav.faq":"FAQ","nav.open":"Open the app",
    "hero.eyebrow":"NEARBY. SOON.","hero.title":"Be here.<br>Go there.",
    "hero.subtitle":"Join plans happening near you in the next few hours, or find the people to travel with. Only verified adults, and no money ever changes hands.",
    "phone.tag":"Be here. Go there.","phone.login":"Log in","phone.explore":"Explore","phone.noAccount":"Don’t have an account?","phone.signup":"Sign up",
    "hero.open":"Open the app","hero.see":"See how it works","hero.floatTitle":"People, not profiles.","hero.floatText":"Meet in real life.","hero.bottom":"A little more together, wherever you are.",
    "modes.eyebrow":"ONE APP. TWO WAYS TO CONNECT.","modes.title":"Your next good thing<br>could be just around the corner.","modes.subtitle":"A spontaneous plan today. A shared adventure tomorrow. Choose your kind of together.",
    "modes.here.kicker":"THE NEXT FEW HOURS","modes.here.description":"Make a plan. Find your people. Meet nearby, soon.",
    "modes.here.b1":"Join coffees, runs, aperitivos and more.","modes.here.b2":"Host with approval or let verified people join instantly.","modes.here.b3":"Keep the conversation going in your plan's group chat.","modes.here.foot":"Nearby. Soon.",
    "modes.there.kicker":"THE NEXT ADVENTURE","modes.there.description":"Find travel companions and shape a trip together.",
    "modes.there.b1":"Discover proposed trips and apply with a short intro.","modes.there.b2":"Build the plan with date polls and a shared itinerary.","modes.there.b3":"Match with buddies heading to the same place and dates.","modes.there.foot":"Go there. Together.",
    "modes.disclaimer":"Every trip is a proposal, never a booking. LAMIS never handles money.",
    "cat.coffee":"Coffee","cat.drinks":"Drinks","cat.food":"Food","cat.sports":"Sports","cat.culture":"Culture","cat.adventure":"Adventure","cat.nature":"Nature","cat.beach":"Beach","cat.photo":"Photography",
    "how.eyebrow":"A SIMPLE WAY TO START","how.title":"Three steps.<br>Then see where it goes.","how.subtitle":"Less planning alone. More doing things together.","how.cta":"Open the app",
    "how.step1.title":"Sign up and get verified once.","how.step1.text":"One identity check helps keep the community for verified adults.",
    "how.step2.title":"Find a plan or a trip, or start your own.","how.step2.text":"Pick something happening nearby, explore a trip proposal, or host.",
    "how.step3.title":"Meet up, chat in the group, and build your reliability.","how.step3.text":"Show up for each other. Your reliability grows through completed plans.",
    "safety.eyebrow":"TRUST IS PART OF THE PLAN","safety.title":"Good company<br>starts with feeling safe.","safety.intro":"Meeting new people should feel exciting, not uncertain. These are the basics we build around.",
    "safety.c1.title":"Verified adults only","safety.c1.text":"Browsing is open to everyone. Only verified adults aged 18+ can create, join or chat.",
    "safety.c2.title":"One check. No ID storage.","safety.c2.text":"We keep the verification result, never your identity documents or selfies.",
    "safety.c3.title":"People review reports","safety.c3.text":"Block and report on every profile, plan and message. Real staff review reports, with urgent ones first.",
    "safety.c4.title":"Reliability you can build","safety.c4.text":"New, Reliable and Very reliable levels come only from verified, completed plans.",
    "safety.c5.title":"Fair if plans go wrong","safety.c5.text":"Hosts can mark no-shows, and people can dispute a no-show mark.",
    "safety.c6.title":"Buddies stay between you","safety.c6.text":"Mutual follows are visible only to the two people involved.",
    "inside.eyebrow":"A LOOK AROUND","inside.title":"A little peek inside.","inside.subtitle":"From the first hello to the details that bring a group together.",
    "gallery.feed.caption":"The HERE feed","gallery.detail.caption":"An activity detail","gallery.trips.caption":"The THERE trip list","gallery.welcome.caption":"The welcome screen",
    "alt.hereFeed":"The LAMIS HERE feed: plans happening in Milan","alt.thereFeed":"The LAMIS THERE feed: trips leaving from Milan","alt.activity":"An activity page with the host’s reliability and a Request to join button","alt.welcome":"The LAMIS welcome screen: Be here. Go there.",
    "faq.eyebrow":"GOOD TO KNOW","faq.title":"A few things<br>you might be wondering.","faq.subtitle":"Still curious? Say hello and ask us.","faq.contact":"Contact us ↗",
    "faq.q1":"Is it free?","faq.a1":"LAMIS helps people connect around plans and trips. Pricing details have not been announced yet.",
    "faq.q2":"Do you handle bookings or payments?","faq.a2":"No. A trip is always a proposal, never a booking. LAMIS never handles money.",
    "faq.q3":"Why do I need to verify?","faq.a3":"Only verified adults aged 18+ can create, join or chat. Browsing remains open to everyone.",
    "faq.q4":"What data do you keep?","faq.a4":"For identity checks, LAMIS keeps only the verification result, never identity documents or selfies.",
    "faq.q5":"Which cities?","faq.a5":"Milan, Italy is the pilot city.","faq.q6":"Which languages?","faq.a6":"LAMIS is available in English and Italian.",
    "footer.privacy":"Privacy","footer.terms":"Terms","footer.contact":"Contact","footer.legal":"18+ only · Privacy first · Terms apply","footer.stores":"Coming soon to the App Store and Google Play"
  },
  it: {
    skip:"Vai al contenuto",
    "nav.how":"Come funziona","nav.safety":"Sicurezza","nav.faq":"FAQ","nav.open":"Apri l'app",
    "hero.eyebrow":"VICINO. PRESTO.","hero.title":"Sii qui.<br>Vai là.",
    "hero.subtitle":"Partecipa a piani vicino a te nelle prossime ore o trova le persone con cui viaggiare. Solo adulti verificati, e il denaro non passa mai da LAMIS.",
    "phone.tag":"Sii qui. Vai là.","phone.login":"Accedi","phone.explore":"Esplora","phone.noAccount":"Non hai un account?","phone.signup":"Registrati",
    "hero.open":"Apri l'app","hero.see":"Scopri come funziona","hero.floatTitle":"Persone, non profili.","hero.floatText":"Incontratevi dal vivo.","hero.bottom":"Un po' più insieme, ovunque tu sia.",
    "modes.eyebrow":"UN'APP. DUE MODI PER CONNETTERSI.","modes.title":"La prossima bella esperienza<br>potrebbe essere dietro l'angolo.","modes.subtitle":"Un piano spontaneo oggi. Un'avventura condivisa domani. Scegli il tuo modo di stare insieme.",
    "modes.here.kicker":"NELLE PROSSIME ORE","modes.here.description":"Organizza un piano. Trova le tue persone. Incontratevi qui vicino, presto.",
    "modes.here.b1":"Partecipa a caffè, corse, aperitivi e altro.","modes.here.b2":"Organizza con approvazione o consenti l'accesso immediato alle persone verificate.","modes.here.b3":"Continua a parlare nella chat di gruppo del tuo piano.","modes.here.foot":"Vicino. Presto.",
    "modes.there.kicker":"LA PROSSIMA AVVENTURA","modes.there.description":"Trova compagni di viaggio e organizza un viaggio insieme.",
    "modes.there.b1":"Scopri i viaggi proposti e candidati con una breve presentazione.","modes.there.b2":"Organizza il viaggio con sondaggi sulle date e un itinerario condiviso.","modes.there.b3":"Trova persone dirette nello stesso luogo e nelle stesse date.","modes.there.foot":"Vai là. Insieme.",
    "modes.disclaimer":"Ogni viaggio è una proposta, mai una prenotazione. LAMIS non gestisce mai denaro.",
    "cat.coffee":"Caffè","cat.drinks":"Drink","cat.food":"Cibo","cat.sports":"Sport","cat.culture":"Cultura","cat.adventure":"Avventura","cat.nature":"Natura","cat.beach":"Mare","cat.photo":"Fotografia",
    "how.eyebrow":"UN MODO SEMPLICE PER INIZIARE","how.title":"Tre passi.<br>E poi si vede dove porta.","how.subtitle":"Meno programmi da soli. Più cose da fare insieme.","how.cta":"Apri l'app",
    "how.step1.title":"Iscriviti e verifica la tua identità una sola volta.","how.step1.text":"Un controllo dell'identità aiuta a mantenere la community riservata agli adulti verificati.",
    "how.step2.title":"Trova un piano o un viaggio, oppure creane uno.","how.step2.text":"Scegli qualcosa qui vicino, esplora una proposta di viaggio o organizza tu.",
    "how.step3.title":"Incontratevi, chattate nel gruppo e costruite la vostra affidabilità.","how.step3.text":"Ci si presenta gli uni per gli altri. L'affidabilità cresce con i piani completati.",
    "safety.eyebrow":"LA FIDUCIA FA PARTE DEL PIANO","safety.title":"Le belle compagnie<br>iniziano sentendosi al sicuro.","safety.intro":"Conoscere nuove persone dovrebbe essere emozionante, non incerto. Queste sono le basi su cui ci fondiamo.",
    "safety.c1.title":"Solo adulti verificati","safety.c1.text":"La navigazione è aperta a tutti. Solo gli adulti verificati di almeno 18 anni possono creare, partecipare o chattare.",
    "safety.c2.title":"Una verifica. Nessun documento conservato.","safety.c2.text":"Conserviamo solo il risultato della verifica, mai documenti d'identità o selfie.",
    "safety.c3.title":"Le segnalazioni sono esaminate da persone","safety.c3.text":"Puoi bloccare e segnalare ogni profilo, piano e messaggio. Il nostro staff esamina le segnalazioni, dando priorità a quelle urgenti.",
    "safety.c4.title":"Un'affidabilità che si costruisce","safety.c4.text":"I livelli Nuovo, Affidabile e Molto affidabile derivano solo da piani verificati e completati.",
    "safety.c5.title":"Equità quando qualcosa va storto","safety.c5.text":"Gli host possono segnalare le assenze e le persone possono contestare una segnalazione.",
    "safety.c6.title":"I buddy restano tra voi","safety.c6.text":"Le connessioni reciproche sono visibili solo alle due persone coinvolte.",
    "inside.eyebrow":"UNO SGUARDO ALL'INTERNO","inside.title":"Dai un'occhiata.","inside.subtitle":"Dal primo saluto ai dettagli che uniscono un gruppo.",
    "gallery.feed.caption":"Il feed HERE","gallery.detail.caption":"Dettaglio di un’attività","gallery.trips.caption":"La lista dei viaggi THERE","gallery.welcome.caption":"La schermata di benvenuto",
    "alt.hereFeed":"Il feed HERE di LAMIS: piani a Milano","alt.thereFeed":"Il feed THERE di LAMIS: viaggi in partenza da Milano","alt.activity":"La pagina di un’attività con l’affidabilità dell’host e il pulsante Richiedi di partecipare","alt.welcome":"La schermata di benvenuto di LAMIS: Sii qui. Vai là.",
    "faq.eyebrow":"DA SAPERE","faq.title":"Forse ti stai<br>chiedendo alcune cose.","faq.subtitle":"Hai ancora domande? Scrivici.","faq.contact":"Contattaci ↗",
    "faq.q1":"È gratis?","faq.a1":"LAMIS aiuta le persone a incontrarsi attraverso piani e viaggi. I dettagli sui prezzi non sono ancora stati annunciati.",
    "faq.q2":"Gestite prenotazioni o pagamenti?","faq.a2":"No. Un viaggio è sempre una proposta, mai una prenotazione. LAMIS non gestisce mai denaro.",
    "faq.q3":"Perché devo verificarmi?","faq.a3":"Solo gli adulti verificati di almeno 18 anni possono creare, partecipare o chattare. La navigazione resta aperta a tutti.",
    "faq.q4":"Quali dati conservate?","faq.a4":"Per la verifica dell'identità, LAMIS conserva solo il risultato, mai documenti d'identità o selfie.",
    "faq.q5":"In quali città?","faq.a5":"Milano, in Italia, è la città pilota.","faq.q6":"Quali lingue?","faq.a6":"LAMIS è disponibile in inglese e italiano.",
    "footer.privacy":"Privacy","footer.terms":"Termini","footer.contact":"Contatti","footer.legal":"Solo maggiorenni · Prima la privacy · Si applicano i termini","footer.stores":"In arrivo su App Store e Google Play"
  }
};

const header = document.getElementById("siteHeader");
const hero = document.querySelector(".hero");
const modeButtons = [...document.querySelectorAll(".mode-option")];
const menuToggle = document.getElementById("menuToggle");
const mobileNav = document.getElementById("mobileNav");

function setAppLinks() {
  document.querySelectorAll("[data-app-link]").forEach(link => link.href = APP_URL);
}
setAppLinks();
document.getElementById("year").textContent = new Date().getFullYear();

function setMode(mode) {
  const there = mode === "there";
  hero.classList.add("is-transitioning");
  window.setTimeout(() => {
    hero.classList.toggle("is-there", there);
    // the whole page follows the mode, not just the hero (see "The whole page follows the HERE | THERE switch" in styles.css)
    document.body.classList.toggle("mode-there", there);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", there ? "#E9E5DD" : "#102F29");
    updateHeader();
    modeButtons.forEach(button => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    // the hero phone builds its welcome screen again, in the new mode's look (see "Hero phone" below)
    heroPhone.rebuild();
    hero.classList.remove("is-transitioning");
  }, 130);
}
modeButtons.forEach(button => button.addEventListener("click", () => setMode(button.dataset.mode)));

function setLanguage(lang) {
  const strings = COPY[lang] || COPY.en;
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const value = strings[el.dataset.i18n];
    if (value !== undefined) el.innerHTML = value;
  });
  document.querySelectorAll("[data-i18n-label]").forEach(el => {
    const value = strings[el.dataset.i18nLabel];
    if (value !== undefined) el.setAttribute("aria-label", value);
  });
  document.querySelectorAll("[data-i18n-alt]").forEach(el => {
    const value = strings[el.dataset.i18nAlt];
    if (value !== undefined) el.alt = value;
  });
  document.querySelectorAll(".lang-button").forEach(button => {
    const active = button.dataset.lang === lang;
    button.classList.toggle("is-current", active);
    button.setAttribute("aria-pressed", String(active));
  });
  setMode(hero.classList.contains("is-there") ? "there" : "here");
}
document.querySelectorAll(".lang-button").forEach(button => button.addEventListener("click", () => setLanguage(button.dataset.lang)));

function updateHeader() {
  const scrolled = window.scrollY > 16;
  header.classList.toggle("is-scrolled", scrolled);
  // at the top of the page over the forest HERE hero, the header is drawn light (see .over-dark in styles.css)
  header.classList.toggle("over-dark", !scrolled && !hero.classList.contains("is-there"));
}
window.addEventListener("scroll", updateHeader, { passive: true });
updateHeader();

menuToggle.addEventListener("click", () => {
  const open = menuToggle.getAttribute("aria-expanded") !== "true";
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  mobileNav.classList.toggle("is-open", open);
});
mobileNav.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
  mobileNav.classList.remove("is-open");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open menu");
}));

document.querySelectorAll(".faq-question").forEach(button => {
  button.addEventListener("click", () => {
    const expanded = button.getAttribute("aria-expanded") === "true";
    const answer = button.closest(".faq-item").querySelector(".faq-answer");
    button.setAttribute("aria-expanded", String(!expanded));
    answer.hidden = expanded;
  });
});

const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const siblings = [...entry.target.parentElement.querySelectorAll(":scope > .reveal")];
        entry.target.style.transitionDelay = `${Math.max(0, siblings.indexOf(entry.target)) * 50}ms`;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: .12 });
  revealItems.forEach(item => observer.observe(item));
} else {
  revealItems.forEach(item => item.classList.add("is-visible"));
}


// Keep a clearly labelled fallback visible only when the supplied photo is missing.
document.querySelectorAll(".hero-photo").forEach(panel => {
  const match = getComputedStyle(panel).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
  if (!match) return;
  const probe = new Image();
  probe.onload = () => { const fallback = panel.querySelector(".photo-fallback"); if (fallback) fallback.hidden = true; };
  probe.onerror = () => { const fallback = panel.querySelector(".photo-fallback"); if (fallback) fallback.hidden = false; };
  probe.src = match[1];
});

// ===== Hero phone =====
// The LAMIS welcome screen, built live (markup: .hp-wrap in index.html; styles: "Hero phone" in styles.css). The timing follows
// the Motion film it came from: the phone glides up and turns into place once, then floats; the screen builds (photo settles,
// wordmark rises, its dot pops, the tagline word by word, then the sheet and its buttons), a soft light crosses the glass and
// later the Log in button. The build plays again on every HERE | THERE or language switch.
const heroPhone = (() => {
  const wrap = document.querySelector(".hp-wrap");
  if (!wrap) return { rebuild() {} };
  const $ = (s) => wrap.querySelector(s);
  const el = { phone: $(".hp-phone"), shadow: $(".hp-shadow"), photo: () => wrap.querySelector(hero.classList.contains("is-there") ? ".hp-img-there" : ".hp-img-here"),
    mark: $(".hp-mark-in"), dot: $(".hp-dot"), tag: $(".hp-tag"), sheet: $(".hp-sheet"), login: $(".hp-login"), explore: $(".hp-explore"),
    row: $(".hp-row"), foot: $(".hp-foot"), shine: $(".hp-shine"), glare: $(".hp-glare") };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  const lerp = (a, b, p) => a + (b - a) * p;
  const eo = (p) => 1 - Math.pow(1 - p, 3);
  const eio = (p) => (p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const eob = (p, s = 1.70158) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let words = [], start = performance.now(), buildStart = start, raf = 0, visible = true;

  function splitTag() {
    // the sentence as written: read it fresh when it is plain text (first time, or after a language switch put new text in),
    // otherwise reuse the saved one (the word pieces have no spaces between them)
    if (!el.tag.querySelector("span")) el.tag.dataset.text = el.tag.textContent.trim();
    const text = el.tag.dataset.text || "";
    el.tag.innerHTML = text.split(/\s+/).map((w) => "<span>" + w.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])) + "</span>").join("");
    words = [...el.tag.children];
  }
  const rise = (node, p, d) => { node.style.opacity = p.toFixed(3); node.style.transform = "translateY(" + ((1 - p) * d).toFixed(1) + "px)"; };

  function render(tp, tb) {
    // the phone: glides up and turns into place, then floats and sways a little
    const g = seg(tp, -0.5, 1.9), turn = seg(tp, -0.5, 2.3), settle = seg(tp, 1.6, 2.8);
    const fl = Math.sin((tp - 1.9) * Math.PI * 2 / 4) * settle, sway = Math.sin((tp - 2) * Math.PI * 2 / 6.5) * settle;
    const y = lerp(190, 0, eo(g)) + 10 * fl;
    const ry = lerp(-30, -9, eio(turn)) + 2.4 * sway, rx = lerp(12, 4, eio(turn)) + 0.8 * fl, rz = lerp(7, -1.5, eob(seg(tp, -0.5, 2.0), 1.3));
    el.phone.style.transform = "translateY(" + y.toFixed(2) + "px) rotateX(" + rx.toFixed(2) + "deg) rotateY(" + ry.toFixed(2) + "deg) rotateZ(" + rz.toFixed(2) + "deg)";
    const lift = clamp01(y / 200);
    el.shadow.style.opacity = (0.95 - lift * 0.55 - fl * 0.06).toFixed(3);
    el.shadow.style.transform = "scale(" + (1 - lift * 0.25 - fl * 0.03).toFixed(3) + ", 1)";
    // the screen builds
    const ps = lerp(1.15, 1.04, eo(seg(tb, -0.5, 3))) - 0.03 * seg(tb, 3, 8);
    el.photo().style.transform = "translateY(" + lerp(-8, 6, seg(tb, 0, 8)).toFixed(1) + "px) scale(" + ps.toFixed(4) + ")";
    const m = eo(seg(tb, 0.8, 1.5));
    el.mark.style.opacity = clamp01(m * 1.6).toFixed(3);
    el.mark.style.transform = "translateY(" + ((1 - m) * 72).toFixed(1) + "px)";
    el.dot.style.transform = "scale(" + Math.max(0, eob(seg(tb, 1.45, 1.9), 1.8)).toFixed(3) + ")";
    words.forEach((w, i) => rise(w, eo(seg(tb, 1.7 + i * 0.11, 2.2 + i * 0.11)), 14));
    el.sheet.style.transform = "translateY(" + lerp(360, 0, eo(seg(tb, 2.25, 3.05))).toFixed(1) + "px)";
    rise(el.login, eo(seg(tb, 2.8, 3.35)), 24);
    rise(el.explore, eo(seg(tb, 3.0, 3.55)), 24);
    rise(el.row, eo(seg(tb, 3.2, 3.75)), 18);
    rise(el.foot, eo(seg(tb, 3.4, 3.95)), 14);
    // a soft light crosses the glass once, and later the Log in button
    const gl = seg(tb, 0.4, 2.6);
    el.glare.style.opacity = (Math.sin(gl * Math.PI) * 0.9).toFixed(3);
    el.glare.style.transform = "translateX(" + lerp(-120, 720, eio(gl)).toFixed(1) + "px) rotate(18deg)";
    const sh = seg(tb, 5.0, 6.0);
    el.shine.style.opacity = Math.sin(sh * Math.PI).toFixed(3);
    el.shine.style.transform = "translateX(" + lerp(-90, 380, eio(sh)).toFixed(1) + "px) skewX(-18deg)";
  }

  function frame(now) {
    raf = 0;
    render((now - start) / 1000, (now - buildStart) / 1000);
    if (visible) raf = requestAnimationFrame(frame);
  }
  function play() { if (!raf && !reduce) raf = requestAnimationFrame(frame); }

  splitTag();
  if (reduce) render(3, 10); // no motion: the finished screen, standing still
  else play();
  // only animate while the hero is on screen
  if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) play(); }).observe(wrap);

  return {
    rebuild() {
      splitTag();
      // the photo of the mode just left keeps no leftover movement
      wrap.querySelectorAll(".hp-img").forEach((img) => (img.style.transform = ""));
      if (reduce) return render(3, 10);
      buildStart = performance.now();
      play();
    },
  };
})();
