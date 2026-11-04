# AI Patient Status Assignment Tool

A mobile-first web tool that helps an overnight physician choose a hospital level of care:
**Inpatient**, **Observation**, or **Needs review**. Utilization-review staff work bank hours, so
this tool fills the gap overnight. It applies the hospital's *Guide for Physicians on Level of Care*
(from our ICU-physician client) to what the physician enters, shows exactly which criteria were or
were not met, and writes a chart note with the wording payers expect.

> **Advisory only. The physician's judgment is final.**
> **Prototype: synthetic data only. Never enter real patient information.**

## What it does

- Pick a payer (Medicare or Other) and a condition. 17 conditions from the guide are included.
- Enter findings. The recommendation updates live in a bar at the bottom of the screen.
- Optionally upload an image of a **synthetic** medical document and use a local AI vision model to extract findings. Review and correct the extracted values before applying them to the form.
- Tap the bar to see why: criteria met, values that were checked but fell short ("Hemoptysis volume 50 mL: not met, needs more than 50 mL"), what is still needed, and reminders from the guide.
- Medicare patients get the 2-midnight question and the five exclusions.
- A copy-ready chart note uses the required wording ("Admit to inpatient for monitoring and/or treatment of ...", "Place the patient in observation for ...") and never "admit to observation".
- If something needed is missing, the tool says **Needs review** and names it. It never guesses and never downgrades a patient on its own. AI-extracted findings must be verified before they are applied; missing optional fields may otherwise be treated as absent by the rules engine.

## Run it locally

Requires **Node.js 20+** and npm. From the `frontend/` folder:

```bash
npm install
npm run dev -- --host     # open the Network address on your phone
npm run test:engine       # rules, cases, Medicare layer, chart-note wording (328 tests)
npm run build             # production build into frontend/dist
```

Open the local URL printed by Vite (typically `http://localhost:5173`). The rules engine and manual-entry features do **not** require Ollama.

## Optional AI image extraction

The AI feature uses **Ollama** with the **Llama 3.2 Vision** model to transcribe findings from images of synthetic medical documents. Ollama is a separate local service; it is **not** required to use the rules engine.

### One-time setup

1. [Install Ollama](https://ollama.com/download) on the computer running the development environment.
2. Open a **new terminal** after installation and verify the command is available:

   ```bash
   ollama --version
   ```

3. Download the model (approximately 7.8 GB; requires sufficient disk space and memory to run):

   ```bash
   ollama pull llama3.2-vision
   ```

4. Ensure the Ollama application/service is running. If it is not already running, start Ollama or use `ollama serve` as appropriate for your installation.
5. From `frontend/`, run `npm run dev` (restart Vite if you just changed `vite.config.js`). The local Vite proxy forwards `/ollama` requests to `http://127.0.0.1:11434`.

### Using image extraction

1. Select a medical condition.
2. Upload an image of a **synthetic** patient document.
3. Click **Extract findings**.
4. Review and correct the extracted values; distinguish explicit negative findings from unknown or unreadable ones.
5. Click **Apply reviewed findings**.
6. Review the resulting recommendation and supporting criteria.

### Troubleshooting

- **`ollama` command not recognized:** Install Ollama, then close and reopen the terminal. Verify with `ollama --version`.
- **Model unavailable:** Check `ollama list` and, if necessary, run `ollama pull llama3.2-vision`.
- **Connection error:** Ensure Ollama is running and check `http://127.0.0.1:11434/api/tags`. Restart the Vite development server after changing its proxy configuration.
- **AI import fails on the public website:** The Vite development proxy works locally only; the Vercel deployment does not currently host an inference service.

## How it is built

Vue 3 + Vite, plain JavaScript and CSS. **Clinical rules evaluation runs in the browser.** Optional image extraction calls a separate local Ollama service through the Vite development proxy.

```text
frontend/src/
  rules/             one JSON file per condition (the clinical rules live HERE)
  cases/             one test-cases file per condition (<id>-cases.json)
  engine.js          evaluates a rule against entered findings (plain JS, no Vue)
  medicare.js        the Medicare 2-midnight layer, applied after the clinical result
  note.js            chart-note generator and the required wording
  rules.js           loads every file in rules/ automatically
  services/vision.js calls Ollama and validates extracted field values
  components/        the screen pieces, including ImageImport.vue
frontend/tests/engine.test.js   runs every rule file and every case file
```

The key idea: **rules are data.** The form, the criteria text, the explanations and the note are all generated from the rule file. Adding or changing a condition does not require changing the rules engine. Image extraction uses the selected condition's input definitions to request the relevant findings. See [docs/ADDING_A_CONDITION.md](docs/ADDING_A_CONDITION.md).

## Deploy

Hosted on Vercel from this GitHub repo. Settings: **Root Directory = `frontend`**, framework preset Vite (build `npm run build`, output `dist`). Every push to `main` redeploys.

**The deployed site supports manual entry and rules-based recommendations, but the Ollama image-extraction feature is not currently available on Vercel.** Vite's local development proxy does not run in production. Enabling remote image extraction would require a separately hosted model/API and an appropriately secured integration.

## Known limitations

- The tool is a hackathon prototype, **not validated for clinical use**. Use synthetic patient data only.
- AI-extracted values can be incorrect even when the response is valid JSON; a user must review them before applying them.
- Missing, ambiguous, or unreadable findings must not be assumed negative. The current rules engine treats blank optional fields as not present.
- Local AI inference requires Ollama and adequate hardware; performance varies by computer.
- AI extraction does not currently work on the public Vercel deployment.

## More

- [docs/ADDING_A_CONDITION.md](docs/ADDING_A_CONDITION.md): add or change a condition (start here to contribute)
- [docs/DEMO.md](docs/DEMO.md): the 3-minute demo script and likely questions
- [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md): where the guide was ambiguous, and what we assumed
