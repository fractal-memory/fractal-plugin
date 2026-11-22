#!/usr/bin/env node
/**
 * fractal-hook.mjs — la memoria arriva da sola, invece di essere chiesta.
 *
 * IL BUCO CHE CHIUDE. Finora fractal si usava solo se l'agente decideva di chiamare
 * `memory_recall`. La skill gli insegna QUANDO farlo, ma resta una decisione: se non la
 * prende, la memoria c'e' e non serve a niente. Questi due hook la rendono automatica sul
 * lato LETTURA — all'inizio della sessione e a ogni domanda — senza togliere niente ai
 * tool, che restano il modo di scrivere e di cercare a fondo.
 *
 * PERCHE' SOLO LA LETTURA. Scrivere in automatico vorrebbe dire decidere da soli cosa di
 * una sessione e' durevole, e la risposta onesta e' che non si sa senza leggere il
 * contenuto: una memoria sbagliata scritta da sola e' peggio di una memoria mancante,
 * perche' poi torna fuori come se fosse un fatto. La scrittura resta deliberata (i tool
 * `memory_add` / `memory_correct`), ed e' una scelta, non un pezzo mancante.
 *
 * E PERCHE' A OGNI PROMPT NO, DI DEFAULT. La prima versione iniettava anche a ogni domanda,
 * e il banco l'ha smontata: alla domanda «qual e' la capitale del Madagascar», con in
 * memoria una sola frase su una serranda a Pontedera, l'hook ha iniettato la serranda —
 * punteggio 0.73. Non e' un guasto: e' il PAVIMENTO di e5, gia' misurato altrove in questo
 * progetto (una query di pura spazzatura contro una frase sul ragu' prende 0.82, una
 * pertinente 0.91). Su questo embedder una soglia assoluta non separa niente, e infatti il
 * pannello aveva gia' rinunciato a inventarne una.
 *
 * La differenza fra i due momenti non e' il punteggio, e' CHI HA DECISO. All'avvio della
 * sessione nessuno ha chiesto niente e un riassunto del progetto e' esattamente cio' che
 * si vuole: una volta sola, e chi installa il plugin l'ha chiesto installandolo. A ogni
 * prompt invece si iniettera' rumore su ogni turno in cui la domanda non c'entra con la
 * memoria — e la maggior parte delle domande non c'entra. Quel caso e' gia' servito bene
 * dal tool `memory_recall` chiamato dall'agente, che e' una DECISIONE: ed e' proprio la
 * decisione a renderlo giusto.
 *
 * Resta accendibile con FRACTAL_HOOK_PROMPT=1 per chi tiene in memoria un solo dominio e
 * sa cosa sta accendendo. Spento, il modo `domanda` esce in silenzio.
 *
 * COME PARLA CON FRACTAL. Via HTTP con una chiave — la stessa superficie pubblica
 * documentata in README/API. Serve:
 *     FRACTAL_URL       (default https://getfractal.it)
 *     FRACTAL_API_KEY   la chiave dell'account
 * Senza chiave l'hook ESCE IN SILENZIO con codice 0: un hook che urla a ogni prompt
 * perche' non e' configurato e' un hook che l'utente disinstalla il giorno dopo.
 *
 * NON DEVE MAI ROMPERE LA SESSIONE. Qualunque errore — rete giu', chiave scaduta, JSON
 * storto, servizio in manutenzione — finisce in un `exit 0` senza output. Il costo di
 * sbagliare qui e' che Claude Code non parte, e nessun recupero di memoria vale quel
 * rischio. Per la stessa ragione c'e' un tetto di tempo esplicito.
 */
const MODO = process.argv[2];                       // "avvio" | "domanda"
const BASE = (process.env.FRACTAL_URL ?? "https://getfractal.it").replace(/\/+$/, "");
const CHIAVE = process.env.FRACTAL_API_KEY ?? "";
const K = Number(process.env.FRACTAL_HOOK_K ?? 5);
/** L'iniezione a ogni prompt e' SPENTA di default: vedi sopra, non e' filtrabile. */
const A_OGNI_PROMPT = /^(1|true|on|si|yes)$/i.test(process.env.FRACTAL_HOOK_PROMPT ?? "");
const TETTO_MS = Number(process.env.FRACTAL_HOOK_TIMEOUT_MS ?? 8000);
/** Quanto testo si inietta al massimo. Oltre, si sta rubando contesto invece di darlo. */
const TETTO_CARATTERI = Number(process.env.FRACTAL_HOOK_MAX_CHARS ?? 1200);

function esci(testo) { if (testo) process.stdout.write(testo); process.exit(0); }

/** Legge lo stdin dell'hook (JSON di Claude Code). Vuoto o storto → oggetto vuoto. */
async function leggiIngresso() {
  if (process.stdin.isTTY) return {};
  const parti = [];
  for await (const c of process.stdin) parti.push(c);
  try { return JSON.parse(Buffer.concat(parti).toString("utf8") || "{}"); } catch { return {}; }
}

/**
 * `stato` — perche' non funziona.
 *
 * Gli hook escono in silenzio per non rompere la sessione: giusto quando girano, pessimo
 * quando si sta installando, perche' «non succede niente» puo' voler dire chiave assente,
 * chiave revocata, indirizzo sbagliato o servizio giu', e sono quattro rimedi diversi.
 * Questo modo e' l'unico che PARLA: si lancia a mano, dice cosa manca, e non lo chiama
 * nessun hook.
 *
 *   node plugin/scripts/fractal-hook.mjs stato
 */
async function stato() {
  const righe = [];
  righe.push(`indirizzo    ${BASE}`);
  if (!CHIAVE) {
    righe.push("chiave       MANCA — esporta FRACTAL_API_KEY (pannello → Chiavi API)");
    process.stdout.write(righe.join("\n") + "\n");
    process.exit(1);
  }
  righe.push(`chiave       ${CHIAVE.slice(0, 6)}…${CHIAVE.slice(-4)}`);
  try {
    const r = await fetch(`${BASE}/api/tool/memory_recall`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": CHIAVE },
      body: JSON.stringify({ query: "prova di collegamento", k: 1 }),
      signal: AbortSignal.timeout(TETTO_MS),
    });
    if (r.status === 401 || r.status === 403) {
      righe.push("collegamento la chiave non e' valida (o e' stata revocata): generane una nuova dal pannello");
      process.stdout.write(righe.join("\n") + "\n");
      process.exit(1);
    }
    if (!r.ok) {
      righe.push(`collegamento il servizio ha risposto ${r.status}`);
      process.stdout.write(righe.join("\n") + "\n");
      process.exit(1);
    }
    const dati = await r.json();
    const testo = (dati?.content ?? []).map((c) => c?.text ?? "").join(" ").trim();
    righe.push("collegamento ok");
    righe.push(`memoria      ${/nessun/i.test(testo.slice(0, 60)) ? "raggiungibile, al momento senza niente di pertinente" : "raggiungibile, e risponde"}`);
    righe.push(`all'avvio    ${"acceso"} · a ogni domanda ${A_OGNI_PROMPT ? "acceso" : "spento (FRACTAL_HOOK_PROMPT=1 per accenderlo)"}`);
  } catch (e) {
    righe.push(`collegamento non raggiungibile: ${e instanceof Error ? e.message : String(e)}`);
    process.stdout.write(righe.join("\n") + "\n");
    process.exit(1);
  }
  process.stdout.write(righe.join("\n") + "\n");
  process.exit(0);
}

async function main() {
  if (MODO === "stato") return stato();
  if (!CHIAVE) esci("");                            // non configurato: silenzio, non un errore
  if (MODO === "domanda" && !A_OGNI_PROMPT) esci("");

  const ingresso = await leggiIngresso();
  // Su `avvio` non c'e' una domanda: si interroga con il PROGETTO, che e' l'unica cosa
  // che si sa gia'. Il nome della cartella e' un pessimo indizio semantico da solo, quindi
  // si chiede in modo esplicito cosa si sa di questo progetto invece di cercare la stringa.
  const cartella = (ingresso.cwd ?? process.cwd()).split(/[\\/]/).filter(Boolean).pop() ?? "";
  const query = MODO === "avvio"
    ? `decisioni, vincoli e preferenze sul progetto ${cartella}`
    : String(ingresso.prompt ?? "").slice(0, 2000);
  if (!query.trim()) esci("");

  let risposta;
  try {
    const r = await fetch(`${BASE}/api/tool/memory_recall`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": CHIAVE },
      body: JSON.stringify({ query, k: K }),
      signal: AbortSignal.timeout(TETTO_MS),
    });
    if (!r.ok) esci("");
    risposta = await r.json();
  } catch { esci(""); }

  // La busta dell'API porta il testo del tool dentro `content`. Si legge in modo
  // difensivo: una forma inattesa non deve diventare un'eccezione dentro un hook.
  const testo = (risposta?.content ?? [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text).join("\n").trim();
  if (!testo) esci("");
  // Nessun risultato utile: fractal risponde in prosa, e una risposta che dice
  // «non ho trovato niente» iniettata a ogni prompt e' rumore, non contesto.
  if (/nessun[ao]\b|non ho trovato|niente in memoria/i.test(testo.slice(0, 120))) esci("");

  const tagliato = testo.length > TETTO_CARATTERI ? testo.slice(0, TETTO_CARATTERI) + "\n…" : testo;
  // La busta NON dice «questo è pertinente»: dice da dove viene e lascia i punteggi
  // dentro. Su questo embedder anche una memoria lontana prende 0.7, quindi affermare la
  // pertinenza sarebbe una bugia utile solo a farla credere.
  esci(`<fractal-memoria>\nQuello che fractal ha in memoria di più vicino a questo progetto. I numeri sono\nsomiglianze, non garanzie: se non c'entra, ignoralo.\n\n${tagliato}\n</fractal-memoria>\n`);
}

main().catch(() => process.exit(0));
