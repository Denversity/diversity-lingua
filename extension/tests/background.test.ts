import { describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "../src/background/apiClient";
import { GlossaryClient } from "../src/background/glossaryClient";
import { TranslationManager } from "../src/background/translationManager";
import { detectLanguage } from "../src/shared/langdetect";
import { maskText, unmask } from "../src/shared/protect";
import { normalizeBaseUrl, sanitizeSettings } from "../src/shared/settings";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const resp = (ids: string[], status = "machine_unvalidated") => ({ request_id: "r", source_lang: "fr", target_lang: "t", took_ms: 1, summary: {},
  results: ids.map((id) => ({ id, status, translation: status === "unavailable" ? null : `T-${id}`, reason: status === "unavailable" ? "no_validated_translation" : null })) });
const noSleep = async () => {};
const mkApi = (fetchImpl: any, o = {}) => new ApiClient(async () => ({ baseUrl: "http://x", token: "tok" }), fetchImpl, { sleep: noSleep, ...o });

describe("ApiClient", () => {
  it("envoie le jeton, sans cookies, et valide la réponse", async () => {
    let init: any;
    const api = mkApi(async (_u: string, i: any) => { init = i; return ok(resp(["a"])); });
    const r = await api.translate("fr", "t", [{ id: "a", text: "Bonjour" }]);
    expect(r.results[0].translation).toBe("T-a");
    expect(init.headers["X-DL-Token"]).toBe("tok"); expect(init.credentials).toBe("omit");
  });
  it("réessaie sur 5xx/réseau puis réussit ; échoue proprement sinon", async () => {
    let n = 0;
    const api = mkApi(async () => { if (++n < 3) throw new TypeError("net"); return ok(resp(["a"])); });
    expect((await api.translate("fr", "t", [{ id: "a", text: "x" }])).results).toHaveLength(1); expect(n).toBe(3);
    const down = mkApi(async () => { throw new TypeError("net"); });
    await expect(down.translate("fr", "t", [])).rejects.toMatchObject({ code: "network" });
    const srv = mkApi(async () => new Response("", { status: 503 }));
    await expect(srv.translate("fr", "t", [])).rejects.toMatchObject({ code: "server" });
  });
  it("401 et 4xx ne sont pas rejoués", async () => {
    let n = 0;
    await expect(mkApi(async () => { n++; return new Response("", { status: 401 }); }).health()).rejects.toMatchObject({ code: "unauthorized" });
    await expect(mkApi(async () => { n++; return new Response("", { status: 422 }); }).health()).rejects.toMatchObject({ code: "http_422" });
    expect(n).toBe(2);
  });
  it("délai d'expiration", async () => {
    const api = mkApi((_u: string, i: any) => new Promise((_r, rej) => i.signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" })))), { timeoutMs: 20, retries: 0 });
    await expect(api.health()).rejects.toMatchObject({ code: "timeout" });
  });
  it("rejette les réponses mal formées", async () => {
    const api = mkApi(async () => ok({ results: [{ id: 1 }] }));
    await expect(api.translate("fr", "t", [])).rejects.toBeInstanceOf(ApiError);
    await expect(mkApi(async () => ok({ results: [{ id: "a", status: "validated", translation: 5 }] })).translate("fr", "t", [])).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("TranslationManager", () => {
  const seg = (id: string, text: string) => ({ id, text });
  function build(responder: (ids: string[]) => any, opts = {}, glossary: GlossaryClient | null = null) {
    const calls: string[][] = [];
    const api = mkApi(async (_u: string, i: any) => { const b = JSON.parse(i.body); calls.push(b.segments.map((s: any) => s.id)); return ok(responder(b.segments.map((s: any) => s.id))); });
    return { calls, mgr: new TranslationManager(api, glossary, { sleep: noSleep, minIntervalMs: 0, ...opts }) };
  }
  it("regroupe par lots et déduplique les textes identiques", async () => {
    const { calls, mgr } = build((ids) => resp(ids), { batchSize: 2 });
    const out = await mgr.translate("fr", "t", [seg("1", "A"), seg("2", "B"), seg("3", "A"), seg("4", "C")]);
    expect(calls.flat()).toHaveLength(3); expect(calls).toHaveLength(2);
    expect(out.map((r) => r.id)).toEqual(["1", "2", "3", "4"]);
    expect(out[0].translation).toBe(out[2].translation);
  });
  it("cache : pas de second appel ; expiration respectée", async () => {
    let now = 0;
    const { calls, mgr } = build((ids) => resp(ids), { now: () => now, cacheTtlMs: 1000 });
    await mgr.translate("fr", "t", [seg("1", "A")]); await mgr.translate("fr", "t", [seg("9", "A")]);
    expect(calls).toHaveLength(1);
    now = 5000; await mgr.translate("fr", "t", [seg("1", "A")]);
    expect(calls).toHaveLength(2);
  });
  it("erreurs : résultat « error » par segment, jamais mis en cache", async () => {
    let fail = true; const calls: number[] = [];
    const api = mkApi(async () => { calls.push(1); return fail ? new Response("", { status: 500 }) : ok(resp(["u0"])); }, { retries: 0 });
    const mgr = new TranslationManager(api, null, { sleep: noSleep, minIntervalMs: 0 });
    expect((await mgr.translate("fr", "t", [seg("1", "A")]))[0]).toMatchObject({ status: "error", reason: "server" });
    fail = false;
    expect((await mgr.translate("fr", "t", [seg("1", "A")]))[0].status).toBe("machine_unvalidated");
    expect(calls).toHaveLength(2);
  });
  it("échec partiel : un lot en erreur n'empêche pas les autres", async () => {
    let n = 0;
    const api = mkApi(async (_u: string, i: any) => { const ids = JSON.parse(i.body).segments.map((s: any) => s.id); return ++n === 1 ? new Response("", { status: 400 }) : ok(resp(ids)); }, { retries: 0 });
    const mgr = new TranslationManager(api, null, { sleep: noSleep, minIntervalMs: 0, batchSize: 1, maxConcurrent: 1 });
    const out = await mgr.translate("fr", "t", [seg("1", "A"), seg("2", "B")]);
    expect(out.map((r) => r.status)).toEqual(["error", "machine_unvalidated"]);
  });
  it("résultat manquant dans la réponse → error", async () => {
    const { mgr } = build(() => resp([]));
    expect((await mgr.translate("fr", "t", [seg("1", "A")]))[0]).toMatchObject({ status: "error", reason: "missing_result" });
  });
  it("glossaire local d'abord (hors ligne), sans appel réseau", async () => {
    const gl = new GlossaryClient(async () => ({ language: "t", version: "1", entries: [{ id: "g1", source_lang: "fr", source_text: "Solde", translation: "BAL", test_data: false }] }));
    const { calls, mgr } = build((ids) => resp(ids), {}, gl);
    const out = await mgr.translate("fr", "t", [seg("1", "Solde :")]);
    expect(out[0]).toMatchObject({ status: "validated", origin: "local-glossary", translation: "BAL" }); expect(calls).toHaveLength(0);
  });
  it("retrouve un libellé court dans sa langue exacte quand la page est détectée dans l'autre langue", async () => {
    const gl = new GlossaryClient(async () => ({ language: "t", version: "1", entries: [
      { id: "g1", source_lang: "en", source_text: "Account number :", translation: "Lamba konto :", test_data: false },
      { id: "g2", source_lang: "fr", source_text: "Numéro de compte :", translation: "Lamba konto :", test_data: false },
      { id: "g3", source_lang: "en", source_text: "Account number", translation: "limngal konto", test_data: false },
    ] }));
    const { calls, mgr } = build((ids) => resp(ids), {}, gl);
    const out = await mgr.translate("fr", "t", [seg("1", "Account number"), seg("2", "Account number :")]);
    expect(out[0]).toMatchObject({ status: "validated", origin: "local-glossary", translation: "limngal konto" });
    expect(out[1]).toMatchObject({ status: "validated", origin: "local-glossary", translation: "Lamba konto :" });
    expect(calls).toHaveLength(0);
  });
  it("traduit le libellé d'un champ suivi d'une valeur sans modifier cette valeur", async () => {
    const gl = new GlossaryClient(async () => ({ language: "ff", version: "1", entries: [
      { id: "account-label", source_lang: "fr", source_text: "Numéro de compte :", translation: "Lamba konto :", test_data: false },
    ] }));
    const { calls, mgr } = build((ids) => resp(ids), {}, gl);
    const masked = maskText("Numéro de compte : CM 001 2345 6789 01");
    const out = await mgr.translate("fr", "ff", [seg("1", masked.masked)]);
    expect(out[0]).toMatchObject({
      status: "validated", origin: "local-glossary",
    });
    expect(unmask(out[0].translation!, masked.tokens)).toBe("Lamba konto : CM 001 2345 6789 01");
    expect(calls).toHaveLength(0);
  });
  it("n'applique pas une entrée locale au milieu d'un mot", async () => {
    const gl = new GlossaryClient(async () => ({ language: "ff", version: "1", entries: [
      { id: "account-label", source_lang: "fr", source_text: "Numéro de compte", translation: "Lamba konto", test_data: false },
    ] }));
    const { calls, mgr } = build((ids) => resp(ids), {}, gl);
    const out = await mgr.translate("fr", "ff", [seg("1", "Numéro de compteXYZ")]);
    expect(out[0].status).toBe("machine_unvalidated");
    expect(calls).toHaveLength(1);
  });
  it("s'abstient si le préfixe du glossaire a plusieurs traductions", async () => {
    const gl = new GlossaryClient(async () => ({ language: "ff", version: "1", entries: [
      { id: "account-a", source_lang: "fr", source_text: "Numéro de compte", translation: "Lamba konto", test_data: false },
      { id: "account-b", source_lang: "fr", source_text: "Numéro de compte", translation: "Limngal konto", test_data: false },
    ] }));
    const { calls, mgr } = build((ids) => resp(ids), {}, gl);
    const out = await mgr.translate("fr", "ff", [seg("1", "Numéro de compte : CM {{P0}}")]);
    expect(out[0].status).toBe("machine_unvalidated");
    expect(calls).toHaveLength(1);
  });
  it("ne tente pas l'autre langue locale si le terme est ambigu entre les deux langues", async () => {
    const gl = new GlossaryClient(async () => ({ language: "t", version: "1", entries: [
      { id: "g1", source_lang: "fr", source_text: "Menu", translation: "A" },
      { id: "g2", source_lang: "fr", source_text: "Menu", translation: "C" },
      { id: "g3", source_lang: "en", source_text: "Menu", translation: "B" },
    ] }));
    const { calls, mgr } = build((ids) => resp(ids), {}, gl);
    const out = await mgr.translate("fr", "t", [seg("1", "Menu")]);
    expect(out[0]).toMatchObject({ status: "machine_unvalidated" });
    expect(calls).toHaveLength(1);
  });
  it("les « indisponibles » stables sont mis en cache brièvement", async () => {
    const { calls, mgr } = build((ids) => resp(ids, "unavailable"));
    await mgr.translate("fr", "t", [seg("1", "A")]); await mgr.translate("fr", "t", [seg("2", "A")]);
    expect(calls).toHaveLength(1);
  });
});

describe("GlossaryClient", () => {
  const snap = (entries: any[]) => async () => ({ language: "t", version: "1", entries });
  it("ignore les ambiguïtés et les entrées sans traduction ; vérifie les jetons", async () => {
    const g = new GlossaryClient(snap([
      { id: "1", source_lang: "fr", source_text: "Envoyer", translation: "A" }, { id: "2", source_lang: "fr", source_text: "Envoyer", translation: "B" },
      { id: "3", source_lang: "fr", source_text: "Vide", translation: "" }, { id: "4", source_lang: "fr", source_text: "Reçu {{P0}}", translation: "R" }]));
    expect(await g.lookup("Envoyer", "fr", "t")).toBeNull();
    expect(await g.lookup("Vide", "fr", "t")).toBeNull();
    expect(await g.lookup("Reçu {{P0}}", "fr", "t")).toBeNull(); // traduction sans jeton → refusée
  });
  it("snapshot absent ou invalide → aucune entrée, pas d'exception", async () => {
    expect(await new GlossaryClient(async () => null).lookup("x", "fr", "t")).toBeNull();
    expect(await new GlossaryClient(async () => { throw new Error("x"); }).lookup("x", "fr", "t")).toBeNull();
  });
});

describe("détection de langue & réglages", () => {
  it("fr / en / inconnu", () => {
    expect(detectLanguage("Vous avez reçu de l'argent sur votre compte et le solde est disponible").lang).toBe("fr");
    expect(detectLanguage("You have received money on your account and the balance is available for the transfer").lang).toBe("en");
    expect(detectLanguage("Dies ist ein Text", "de").lang).toBe("unknown");
    expect(detectLanguage("xyz", "fr-CM").lang).toBe("fr");
  });
  it("URL du serveur : HTTPS obligatoire hors localhost ; valeurs invalides ramenées aux défauts", () => {
    expect(normalizeBaseUrl("http://localhost:8000/")).toBe("http://localhost:8000");
    expect(() => normalizeBaseUrl("http://exemple.cm")).toThrow();
    expect(() => normalizeBaseUrl("ftp://x")).toThrow();
    const s = sanitizeSettings({ backendUrl: "javascript:alert(1)", marks: "bogus" as any, targetLang: "../x" });
    expect(s).toMatchObject({ backendUrl: "http://localhost:8000", marks: "unvalidated", targetLang: "ff" });
  });
});
