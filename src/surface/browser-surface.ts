import { chromium, type Browser, type BrowserContext, type Frame, type Locator as PwLocator, type Page } from 'playwright';
import type { Locator, Observation } from '../core/schemas.js';
import type { Surface, Target } from './surface.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class BrowserSurface implements Surface {
  private constructor(private readonly browser: Browser, readonly context: BrowserContext, readonly page: Page) {}

  static async launch(options: { headless?: boolean } = {}): Promise<BrowserSurface> {
    const headless = options.headless ?? true;
    const browser = await chromium.launch({
      headless,
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {})
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    const page = await context.newPage();
    page.setDefaultTimeout(4_000);
    return new BrowserSurface(browser, context, page);
  }

  currentUrl(): string { return this.page.url(); }
  async navigate(url: string): Promise<void> { await this.page.goto(url, { waitUntil: 'load' }); await this.settle(); }

  private async settle(): Promise<void> {
    await Promise.all(this.frames().map((frame) => frame.waitForLoadState('domcontentloaded').catch(() => undefined)));
  }

  private frames(): Frame[] { return this.page.frames(); }

  private locatorFor(frame: Frame, locator: Locator): PwLocator {
    switch (locator.strategy) {
      case 'role': return frame.getByRole(locator.role as never, { ...(locator.name ? { name: locator.name } : {}), exact: locator.exact });
      case 'label': return frame.getByLabel(locator.label, { exact: locator.exact });
      case 'text': return frame.getByText(locator.text, { exact: locator.exact });
      case 'css': return frame.locator(locator.selector);
      case 'coordinate': return frame.locator('body');
    }
  }

  async resolveLocator(locator: Locator): Promise<number> {
    if (locator.strategy === 'coordinate') return 1;
    let count = 0;
    for (const frame of this.frames()) count += await this.locatorFor(frame, locator).count();
    return count;
  }

  private async resolve(target: Target): Promise<{ locator?: PwLocator; coordinate?: { x: number; y: number } }> {
    const failures: string[] = [];
    for (const candidate of target.locators) {
      if (candidate.strategy === 'coordinate') {
        const viewport = this.page.viewportSize();
        if (viewport?.width === candidate.viewport.width && viewport.height === candidate.viewport.height) return { coordinate: { x: candidate.x, y: candidate.y } };
        failures.push(`coordinate viewport mismatch: recorded ${candidate.viewport.width}x${candidate.viewport.height}, current ${viewport?.width}x${viewport?.height}`);
        continue;
      }
      for (const frame of this.frames()) {
        const locator = this.locatorFor(frame, candidate);
        const count = await locator.count();
        if (count >= target.minimumMatches && count <= target.maximumMatches) return { locator: locator.first() };
        failures.push(`${candidate.strategy} in ${frame.url()}: ${count} matches`);
      }
    }
    throw new Error(`Target not resolved: ${target.description}. ${failures.join('; ')}`);
  }

  async click(target: Target): Promise<void> {
    const resolved = await this.resolve(target);
    if (resolved.coordinate) await this.page.mouse.click(resolved.coordinate.x, resolved.coordinate.y);
    else await resolved.locator!.click();
    await this.page.waitForTimeout(75);
    await this.settle();
  }

  async type(target: Target, value: string, clear = true): Promise<void> {
    const resolved = await this.resolve(target);
    if (!resolved.locator) throw new Error(`Cannot type into coordinate-only target: ${target.description}`);
    if (clear) await resolved.locator.fill(value); else await resolved.locator.pressSequentially(value);
  }

  async read(target: Target): Promise<string> {
    const resolved = await this.resolve(target);
    if (!resolved.locator) throw new Error(`Cannot extract from coordinate-only target: ${target.description}`);
    return (await resolved.locator.innerText()).trim();
  }

  async exists(target: Target): Promise<boolean> {
    try { await this.resolve(target); return true; } catch { return false; }
  }

  async observe(): Promise<Observation> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.captureObservation(); }
      catch (error) { lastError = error; await this.page.waitForTimeout(50); }
    }
    throw lastError;
  }

  private async captureObservation(): Promise<Observation> {
    await this.settle();
    const elements: Observation['interactiveElements'] = [];
    let index = 0;
    for (const frame of this.frames()) {
      const frameOffset = frame === this.page.mainFrame()
        ? { x: 0, y: 0 }
        : await frame.frameElement().then((element) => element.boundingBox()).catch(() => null);
      const data = await frame.locator('button,input:not([type="hidden"]),select,textarea,a,[role="button"],[role="dialog"],[data-field]').evaluateAll((nodes) => nodes.map((node) => {
        const el = node as HTMLElement;
        const input = node as HTMLInputElement;
        const box = el.getBoundingClientRect();
        return {
          role: el.getAttribute('role') || ({ INPUT: 'textbox', BUTTON: 'button', A: 'link', SELECT: 'combobox', TEXTAREA: 'textbox', TD: 'cell' }[el.tagName] ?? el.tagName.toLowerCase()),
          name: el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || input.value || el.getAttribute('name') || '',
          tag: el.tagName.toLowerCase(), disabled: 'disabled' in input ? input.disabled : false,
          value: el.hasAttribute('data-field') ? el.innerText : ('value' in input ? input.value : undefined),
          box: box.width && box.height ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
        };
      }));
      for (const item of data) elements.push({
        ref: `e${++index}`, ...item,
        box: item.box && frameOffset ? { ...item.box, x: item.box.x + frameOffset.x, y: item.box.y + frameOffset.y } : item.box
      });
    }
    const visibleText = (await Promise.all(this.frames().map(async (frame) => frame.locator('body').innerText().catch(() => '')))).join('\n').slice(0, 12_000);
    return { url: this.page.url(), title: await this.page.title(), visibleText, interactiveElements: elements };
  }

  async elementTarget(ref: string): Promise<Target> {
    const observation = await this.observe();
    const element = observation.interactiveElements.find((item) => item.ref === ref);
    if (!element) throw new Error(`Unknown element reference: ${ref}`);
    const locators: Locator[] = [];
    if (element.role && element.name) locators.push({ strategy: 'role', role: element.role === 'input' ? 'textbox' : element.role, name: element.name, exact: true });
    if (element.name) locators.push({ strategy: 'text', text: element.name, exact: true });
    if (element.box) locators.push({ strategy: 'coordinate', x: element.box.x + element.box.width / 2, y: element.box.y + element.box.height / 2, viewport: { width: 1280, height: 800 } });
    return { description: `${element.role} ${element.name}`.trim(), locators, minimumMatches: 1, maximumMatches: 1 };
  }

  async screenshot(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const masks = this.frames().flatMap((frame) => [
      frame.locator('input:not([type="hidden"])'),
      frame.locator('[data-field]'),
      frame.locator('table[summary="Member profile"] td:not(.key)')
    ]);
    await this.page.screenshot({ path, fullPage: true, mask: masks, maskColor: '#222222' });
  }
  async content(): Promise<string> { return this.page.content(); }
  async clickCoordinates(x: number, y: number): Promise<void> { await this.page.mouse.click(x, y); }
  async typeRaw(value: string): Promise<void> { await this.page.keyboard.type(value); }
  async close(): Promise<void> { await this.browser.close(); }
}
