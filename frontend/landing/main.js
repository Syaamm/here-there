// Where every "Get the app" button goes: the web version of the app, served at /app/ next to this page.
const APP_URL = "/app/";

const COPY = {
  en: {
    skip:"Skip to content",
    "nav.how":"How it works","nav.safety":"Safety","nav.faq":"FAQ","nav.open":"Get the app",
    "hero.eyebrow":"NEARBY. SOON.","hero.title":"Be here.<br>Go there.",
    "hero.subtitle":"Join plans happening near you in the next few hours, or find the people to travel with. Only verified adults, and no money ever changes hands.",
    "phone.tag":"Be here. Go there.","phone.login":"Log in","phone.explore":"Explore","phone.noAccount":"Don’t have an account?","phone.signup":"Sign up",
    "hero.open":"Get the app","hero.see":"See how it works","hero.floatTitle":"People, not profiles.","hero.floatText":"Meet in real life.","hero.bottom":"A little more together, wherever you are.",
    "modes.eyebrow":"ONE APP. TWO WAYS TO CONNECT.","modes.title":"Your next good thing<br>could be just around the corner.","modes.subtitle":"A spontaneous plan today. A shared adventure tomorrow. Choose your kind of together.",
    "modes.here.kicker":"THE NEXT FEW HOURS","modes.here.description":"Make a plan. Find your people. Meet nearby, soon.",
    "modes.here.b1":"Join coffees, runs, aperitivos and more.","modes.here.b2":"Host with approval or let verified people join instantly.","modes.here.b3":"Keep the conversation going in your plan's group chat.","modes.here.foot":"Nearby. Soon.",
    "modes.there.kicker":"THE NEXT ADVENTURE","modes.there.description":"Find travel companions and shape a trip together.",
    "modes.there.b1":"Discover proposed trips and apply with a short intro.","modes.there.b2":"Build the plan with date polls and a shared itinerary.","modes.there.b3":"Match with buddies heading to the same place and dates.","modes.there.foot":"Go there. Together.",
    "modes.disclaimer":"Every trip is a proposal, never a booking. LAMIS never handles money.",
    "cat.coffee":"Coffee","cat.drinks":"Drinks","cat.food":"Food","cat.sports":"Sports","cat.culture":"Culture","cat.adventure":"Adventure","cat.nature":"Nature","cat.beach":"Beach","cat.photo":"Photography",
    "how.eyebrow":"A SIMPLE WAY TO START","how.title":"Three steps.<br>Then see where it goes.","how.subtitle":"Less planning alone. More doing things together.","how.cta":"Get the app",
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
    "nav.how":"Come funziona","nav.safety":"Sicurezza","nav.faq":"FAQ","nav.open":"Scarica l'app",
    "hero.eyebrow":"VICINO. PRESTO.","hero.title":"Sii qui.<br>Vai là.",
    "hero.subtitle":"Partecipa a piani vicino a te nelle prossime ore o trova le persone con cui viaggiare. Solo adulti verificati, e il denaro non passa mai da LAMIS.",
    "phone.tag":"Sii qui. Vai là.","phone.login":"Accedi","phone.explore":"Esplora","phone.noAccount":"Non hai un account?","phone.signup":"Registrati",
    "hero.open":"Scarica l'app","hero.see":"Scopri come funziona","hero.floatTitle":"Persone, non profili.","hero.floatText":"Incontratevi dal vivo.","hero.bottom":"Un po' più insieme, ovunque tu sia.",
    "modes.eyebrow":"UN'APP. DUE MODI PER CONNETTERSI.","modes.title":"La prossima bella esperienza<br>potrebbe essere dietro l'angolo.","modes.subtitle":"Un piano spontaneo oggi. Un'avventura condivisa domani. Scegli il tuo modo di stare insieme.",
    "modes.here.kicker":"NELLE PROSSIME ORE","modes.here.description":"Organizza un piano. Trova le tue persone. Incontratevi qui vicino, presto.",
    "modes.here.b1":"Partecipa a caffè, corse, aperitivi e altro.","modes.here.b2":"Organizza con approvazione o consenti l'accesso immediato alle persone verificate.","modes.here.b3":"Continua a parlare nella chat di gruppo del tuo piano.","modes.here.foot":"Vicino. Presto.",
    "modes.there.kicker":"LA PROSSIMA AVVENTURA","modes.there.description":"Trova compagni di viaggio e organizza un viaggio insieme.",
    "modes.there.b1":"Scopri i viaggi proposti e candidati con una breve presentazione.","modes.there.b2":"Organizza il viaggio con sondaggi sulle date e un itinerario condiviso.","modes.there.b3":"Trova persone dirette nello stesso luogo e nelle stesse date.","modes.there.foot":"Vai là. Insieme.",
    "modes.disclaimer":"Ogni viaggio è una proposta, mai una prenotazione. LAMIS non gestisce mai denaro.",
    "cat.coffee":"Caffè","cat.drinks":"Drink","cat.food":"Cibo","cat.sports":"Sport","cat.culture":"Cultura","cat.adventure":"Avventura","cat.nature":"Natura","cat.beach":"Mare","cat.photo":"Fotografia",
    "how.eyebrow":"UN MODO SEMPLICE PER INIZIARE","how.title":"Tre passi.<br>E poi si vede dove porta.","how.subtitle":"Meno programmi da soli. Più cose da fare insieme.","how.cta":"Scarica l'app",
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

// FAQ: the answer slides open (its height grows while the text rises and fades in) and slides shut again.
const faqReduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
document.querySelectorAll(".faq-question").forEach(button => {
  button.addEventListener("click", () => {
    const expanded = button.getAttribute("aria-expanded") === "true";
    const answer = button.closest(".faq-item").querySelector(".faq-answer");
    const text = answer.firstElementChild;
    button.setAttribute("aria-expanded", String(!expanded));
    if (faqReduce || !answer.animate) { answer.hidden = expanded; return; }
    // a click during an animation takes over from wherever the answer is now
    const from = answer.hidden ? 0 : answer.getBoundingClientRect().height;
    answer.getAnimations().forEach(a => a.cancel());
    text?.getAnimations().forEach(a => a.cancel());
    answer.hidden = false;
    const full = answer.scrollHeight, pad = getComputedStyle(answer).paddingBottom;
    const ease = "cubic-bezier(.22,1,.36,1)";
    answer.style.overflow = "hidden";
    if (!expanded) {
      answer.animate([{ height: from + "px", paddingBottom: from ? pad : "0px" }, { height: full + "px", paddingBottom: pad }], { duration: 420, easing: ease })
        .onfinish = () => { answer.style.overflow = ""; };
      text?.animate([{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }], { duration: 380, delay: 80, easing: ease, fill: "backwards" });
    } else {
      const anim = answer.animate([{ height: from + "px", paddingBottom: pad, opacity: 1 }, { height: "0px", paddingBottom: "0px", opacity: 0 }], { duration: 320, easing: ease });
      anim.onfinish = () => { answer.hidden = true; answer.style.overflow = ""; };
    }
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

// ===== Text reveal on scroll =====
// Every piece of text below the hero (eyebrows, headings, paragraphs, links, FAQ rows, footer) rises and fades in as
// it scrolls into view; pieces that arrive together follow one another. Styles: "Text reveal" in styles.css. The hero text
// plays the same reveal once on load (.hero-intro). Text inside the phone mockups is left alone.
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) return;
  const picks = "main section:not(.hero) :is(.eyebrow, h2, h3, p, .text-link, .faq-item, .mode-kicker), .site-footer :is(.footer-links a, .footer-bottom > span, .powered-by)";
  const skip = ".phone, .phone-gallery-frame, .hp-wrap, [aria-hidden='true'], .faq-answer, .faq-item h3";
  const items = [...document.querySelectorAll(picks)].filter(el => !el.closest(skip) && !el.parentElement.closest(".rt"));
  items.forEach(el => el.classList.add("rt"));
  const observer = new IntersectionObserver(entries => {
    const arriving = entries.filter(e => e.isIntersecting).map(e => e.target)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    arriving.forEach((el, i) => {
      el.style.transitionDelay = `${Math.min(i, 8) * 90}ms`;
      el.classList.add("rt-in");
      observer.unobserve(el);
    });
  }, { threshold: .15, rootMargin: "0px 0px -6% 0px" });
  items.forEach(el => observer.observe(el));
  document.documentElement.classList.add("rt-on");
})();


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
// The LAMIS welcome screen, built live (markup: .hp-wrap in index.html; styles: "Hero phone" in styles.css). The motion follows
// the Motion film it came from ("Lamis Welcome Screen"): the finished screen floats and turns gently in a seamless 8 s loop,
// a soft light crosses the glass and the Log in button catches a glint once per loop.
const heroPhone = (() => {
  const wrap = document.querySelector(".hp-wrap");
  if (!wrap) return { rebuild() {} };
  const $ = (s) => wrap.querySelector(s);
  const el = { phone: $(".hp-phone"), shadow: $(".hp-shadow"), photo: () => wrap.querySelector(hero.classList.contains("is-there") ? ".hp-img-there" : ".hp-img-here"),
    mark: $(".hp-mark-in"), dot: $(".hp-dot"), tag: $(".hp-tag"), sheet: $(".hp-sheet"), login: $(".hp-login"), explore: $(".hp-explore"),
    row: $(".hp-row"), foot: $(".hp-foot"), shine: wrap.querySelectorAll(".hp-shine"), glare: wrap.querySelectorAll(".hp-glare") };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  const lerp = (a, b, p) => a + (b - a) * p;
  const eio = (p) => (p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let words = [], start = performance.now(), raf = 0, visible = true;

  function splitTag() {
    // the sentence as written: read it fresh when it is plain text (first time, or after a language switch put new text in),
    // otherwise reuse the saved one (the word pieces have no spaces between them)
    if (!el.tag.querySelector("span")) el.tag.dataset.text = el.tag.textContent.trim();
    const text = el.tag.dataset.text || "";
    el.tag.innerHTML = text.split(/\s+/).map((w) => "<span>" + w.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])) + "</span>").join("");
    words = [...el.tag.children];
  }
  const glow = wrap.querySelector(".hp-glow");

  function render(t) {
    // A seamless 8 s loop: every motion is a sine whose period divides 8, so second 8 matches second 0.
    const L = 8, p = (t % L) / L, lt = t % L, TAU = Math.PI * 2;
    const a = Math.sin(TAU * p), b = Math.sin(TAU * p * 2), c = Math.cos(TAU * p);
    // the camera breathes very slightly; the phone floats: two gentle bobs and one slow turn per loop
    const s = 1.012 + 0.008 * c, y = -12 * b;
    const ry = -8 + 7 * a, rx = 4 + 1.2 * b, rz = -1.2 + 1.0 * c;
    el.phone.style.transform = "scale(" + s.toFixed(4) + ") translateY(" + y.toFixed(2) + "px) rotateX(" + rx.toFixed(2) + "deg) rotateY(" + ry.toFixed(2) + "deg) rotateZ(" + rz.toFixed(2) + "deg)";
    el.shadow.style.opacity = (0.82 + 0.12 * b).toFixed(3);
    el.shadow.style.transform = "translateX(" + (-10 * a).toFixed(1) + "px) scale(" + (1 + 0.05 * b).toFixed(3) + ", 1)";
    if (glow) glow.style.opacity = (0.88 + 0.12 * b).toFixed(3);
    // the photo drifts a touch, like a live moment
    el.photo().style.transform = "translate(" + (-6 * a).toFixed(1) + "px," + (3 * c).toFixed(1) + "px) scale(" + (1.05 + 0.015 * c).toFixed(4) + ")";
    // light glides across the glass as the phone turns toward it, then the Log in button catches a glint
    const gl = seg(lt, 1.2, 3.6);
    const glO = (Math.sin(gl * Math.PI) * 0.9).toFixed(3), glT = "translateX(" + lerp(-120, 720, eio(gl)).toFixed(1) + "px) rotate(18deg)";
    el.glare.forEach((g) => { g.style.opacity = glO; g.style.transform = glT; });
    const sh = seg(lt, 4.6, 5.6);
    const shO = Math.sin(sh * Math.PI).toFixed(3), shT = "translateX(" + lerp(-90, 400, eio(sh)).toFixed(1) + "px) skewX(-18deg)";
    el.shine.forEach((g) => { g.style.opacity = shO; g.style.transform = shT; });
  }

  function frame(now) {
    raf = 0;
    render((now - start) / 1000);
    if (visible) raf = requestAnimationFrame(frame);
  }
  function play() { if (!raf && !reduce) raf = requestAnimationFrame(frame); }

  splitTag();
  if (reduce) render(0); // no motion: the screen standing still
  else play();
  // only animate while the hero is on screen
  if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) play(); }).observe(wrap);

  return {
    rebuild() {
      splitTag();
      // the photo of the mode just left keeps no leftover movement
      wrap.querySelectorAll(".hp-img").forEach((img) => (img.style.transform = ""));
      if (reduce) return render(0);
      play();
    },
  };
})();
