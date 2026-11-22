# fractal — plugin per Claude Code e Grok Bot

> **English.** Long-term memory for AI agents from [fractal](https://getfractal.it). This package works in Claude Code and Grok Bot: it brings the MCP server `https://getfractal.it/mcp` (sign in with your fractal account via OAuth, no key in chat), the `fractal` skill (when to recall, what to save, when to correct) and a `SessionStart` hook that loads the project memory. In Grok Bot: add the plugin, sign in when asked, done.

Fa arrivare la memoria **da sola** all'inizio di ogni sessione, invece di aspettare che
l'agente si ricordi di chiederla.

## Cosa fa, esattamente

| momento | cosa succede |
|---|---|
| `SessionStart` | chiede a fractal cosa sa di questo progetto e lo mette nel contesto |
| `UserPromptSubmit` | **spento di default** — vedi sotto, non è una dimenticanza |

La **scrittura** resta deliberata: i tool `memory_add` / `memory_correct` continuano a
essere chiamati dall'agente. Decidere da soli cosa di una sessione è durevole vorrebbe
dire scrivere memorie sbagliate senza che nessuno le abbia controllate, e una memoria
sbagliata è peggio di una mancante — poi torna fuori come se fosse un fatto.

## Grok Bot (xAI)

I plugin di Grok Bot hanno lo stesso formato di quelli di Claude Code: Grok legge
`.claude-plugin/plugin.json`, espande `${CLAUDE_PLUGIN_ROOT}` e porta con sé il server MCP di
`.mcp.json` e le skill di `skills/`. Questo pacchetto quindi serve anche lì:

- **server MCP** `https://getfractal.it/mcp` (HTTP): l'accesso è con il proprio account fractal,
  con OAuth. Nessuna chiave passa nella chat.
- **skill `fractal`**: quando cercare, cosa salvare, quando correggere (la stessa che il sito
  pubblica su `https://getfractal.it/skills/fractal/SKILL.md`).
- **hook**: senza `FRACTAL_API_KEY` escono in silenzio; un Bot nel cloud usa i tool del server MCP.

Senza il plugin, Grok Bot si collega lo stesso: nel pannello, «Collega il tuo agente» → Grok Bot dà
il messaggio da incollare in chat.

## Installazione

Il plugin è questo repository: va registrato in Claude Code e gli va data una chiave.

```bash
git clone https://github.com/fractal-memory/fractal-plugin.git
```

```bash
# 1. la chiave: pannello → Chiavi API → crea. Si vede una volta sola.
export FRACTAL_API_KEY=fr_...
export FRACTAL_URL=https://getfractal.it   # solo se hai un'istanza tua

# 2. gli hook, in ~/.claude/settings.json (o .claude/settings.json del progetto):
#    il percorso e' quello della cartella dove hai clonato questo repository.
```

```jsonc
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "timeout": 20,
        "command": "node \"/percorso/di/fractal-plugin/scripts/fractal-hook.mjs\" avvio" }] }
    ]
  }
}
```

L'hook `UserPromptSubmit` sta in `hooks/hooks.json` ma **di default non va
registrato**: il perche' e' più sotto, ed e' una misura, non una dimenticanza.

```bash
# 3. la prova: questo e' l'unico comando che PARLA
node scripts/fractal-hook.mjs stato
```

```
indirizzo    https://getfractal.it
chiave       fr_a1b2…9f0c
collegamento ok
memoria      raggiungibile, e risponde
all'avvio    acceso · a ogni domanda spento (FRACTAL_HOOK_PROMPT=1 per accenderlo)
```

Gli hook veri escono sempre in silenzio — è la regola che impedisce loro di rompere la
sessione — quindi quando qualcosa non va «non succede niente», e non succede niente allo
stesso modo se la chiave manca, se e' stata revocata, se l'indirizzo e' sbagliato o se il
servizio e' giu'. `stato` distingue i quattro casi e dice quale.

## Configurazione

```bash
export FRACTAL_API_KEY=fr_...            # la chiave del tuo account (pannello → Chiavi)
export FRACTAL_URL=https://getfractal.it # solo se hai un'istanza tua
```

Senza `FRACTAL_API_KEY` gli hook **escono in silenzio**: non configurato non è un errore.

| variabile | default | cosa fa |
|---|---|---|
| `FRACTAL_HOOK_K` | `5` | quante memorie chiedere |
| `FRACTAL_HOOK_MAX_CHARS` | `1200` | tetto all'iniezione |
| `FRACTAL_HOOK_TIMEOUT_MS` | `8000` | quanto aspettare fractal |
| `FRACTAL_HOOK_PROMPT` | spento | accende l'iniezione a **ogni** prompt |

## Perché l'iniezione a ogni prompt è spenta

Perché misurandola non funzionava. Con in memoria una sola frase su una serranda a
Pontedera, alla domanda «qual è la capitale del Madagascar» l'hook iniettava la serranda,
con punteggio **0.73**.

Non è un guasto: è il *pavimento* di similarità di e5. Contro una frase sul ragù, una query
di pura spazzatura prende 0.82 e una pertinente 0.91 — su questo embedder nessuna soglia
assoluta separa il segnale dal rumore, e infatti il pannello aveva già rinunciato a
inventarne una.

La differenza fra i due momenti non è il punteggio, è **chi ha deciso**. All'avvio della
sessione nessuno ha chiesto niente e un riassunto del progetto è quello che si vuole: una
volta sola, e chi installa il plugin l'ha chiesto installandolo. A ogni prompt invece si
inietta rumore su ogni turno in cui la domanda non c'entra — e la maggior parte non
c'entra. Quel caso è già servito bene dal tool `memory_recall` chiamato dall'agente: è una
decisione, ed è la decisione a renderlo giusto.

Chi tiene in memoria un solo dominio e sa cosa sta accendendo può accenderla con
`FRACTAL_HOOK_PROMPT=1`.

## Non può rompere la sessione

Qualunque errore — rete giù, chiave scaduta, servizio in manutenzione, stdin storto —
finisce in `exit 0` senza output. Il costo di sbagliare qui non è perdere una memoria: è
che Claude Code non parte. Il banco del repository di fractal lo verifica lanciando gli hook
come processi veri contro un servizio vero, in tutti e quattro i casi.

## Licenza

MIT — vedi [LICENSE](LICENSE).
