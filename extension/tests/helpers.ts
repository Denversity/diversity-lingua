import type { BgRequest, BgResponse, ClientResult } from "../src/shared/types";
import { PageTranslator, type ControllerSettings } from "../src/content/controller";

export const FR_PAGE = `
<main>
  <h1>Votre compte</h1>
  <p id="p1">Vous avez reçu de l'argent sur votre compte et le solde est disponible.</p>
  <button id="b1">Envoyer de l'argent</button>
  <p id="amt">Solde disponible : 125 000 FCFA</p>
  <label for="ph">Numéro du destinataire</label>
  <input id="ph" placeholder="Entrez le numéro" value="677 12 34 56">
  <input id="pin" type="password" value="4821" placeholder="Code PIN">
  <textarea id="ta">Message pour le destinataire</textarea>
  <div id="ce" contenteditable="true">Texte éditable par l'utilisateur</div>
  <p id="nt" translate="no">Marque non traduisible</p>
  <p id="ig" data-dl-ignore>Ignoré volontairement</p>
  <script>var x = "Ne pas traduire";</script>
</main>`;

export interface Fake { calls: BgRequest[]; send: (r: BgRequest) => Promise<BgResponse<any>> }

/** Double du backend : glossaire pour « Envoyer de l'argent », machine pour le reste, « indispo » → indisponible. */
export function fakeBackend(opts: { fail?: boolean; delay?: number; mutate?: (id: string, text: string) => string } = {}): Fake {
  const calls: BgRequest[] = [];
  return {
    calls,
    send: async (req) => {
      calls.push(req);
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      if (opts.fail) return { ok: false, error: "x", code: "network" };
      if (req.type !== "dl/translate") return { ok: true, data: null };
      const data: ClientResult[] = req.segments.map((s) => {
        if (s.text === "Envoyer de l'argent") return { id: s.id, status: "validated", translation: "[TEST] Envoyer de l'argent", test_data: true };
        if (s.text.includes("indispo")) return { id: s.id, status: "unavailable", translation: null, reason: "no_validated_translation" };
        const tr = opts.mutate ? opts.mutate(s.id, s.text) : `[TEST~] ${s.text}`;
        return { id: s.id, status: "machine_unvalidated", translation: tr, test_data: true };
      });
      return { ok: true, data };
    },
  };
}

export function makeTranslator(fake: Fake, settings: Partial<ControllerSettings> = {}) {
  const states: string[] = [];
  const tr = new PageTranslator({
    doc: document, send: fake.send, mutationDelayMs: 10, batchSize: 50,
    settings: () => ({ translateAttributes: true, marks: "unvalidated", ...settings }),
    defaultTarget: () => "xx-test",
    onState: (s) => states.push(s.phase),
  });
  return { tr, states };
}
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
