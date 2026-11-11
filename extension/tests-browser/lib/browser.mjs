// Lance un VRAI Chromium (headless). Priorité : CHROME_PATH (votre Chrome installé), sinon @sparticuz/chromium (optionnel).
import puppeteer from "puppeteer-core";

export async function launch() {
  let executablePath = process.env.CHROME_PATH, args = ["--no-sandbox", "--font-render-hinting=none"], headless = "new";
  if (!executablePath) {
    const chromium = (await import("@sparticuz/chromium")).default;
    executablePath = await chromium.executablePath();
    args = [...chromium.args, "--no-sandbox"];
    headless = "shell";
  }
  return puppeteer.launch({ executablePath, args, headless, defaultViewport: { width: 1100, height: 760, deviceScaleFactor: 1 } });
}
