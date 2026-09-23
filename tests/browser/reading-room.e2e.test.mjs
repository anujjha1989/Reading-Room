import assert from "node:assert/strict";
import test from "node:test";
import { launchBrowser } from "./cdp-browser.mjs";

const BASE_URL = process.env.READING_ROOM_BASE_URL || "http://anujrpi.local:4311";

test("Reading Room critical mobile flows", { timeout: 120_000 }, async (suite) => {
  const browser = await launchBrowser();
  suite.after(() => browser.close());
  const consoleProblems = [];
  browser.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    consoleProblems.push(exceptionDetails.exception?.description || exceptionDetails.text);
  });
  browser.on("Log.entryAdded", ({ entry }) => {
    if (entry.level === "error") consoleProblems.push(entry.text);
  });

  await suite.test("library renders and core menus respond", async () => {
    await browser.goto(`${BASE_URL}/?e2e=${Date.now()}`);
    await browser.waitFor(`document.documentElement.dataset.rrLibraryReady === '1'`, { attempts: 120 });
    await browser.waitFor(`document.querySelectorAll('.book').length > 0`, { attempts: 120 });
    const identity = await browser.evaluate(`({
      title: document.title,
      heading: document.querySelector('.hero h1')?.textContent,
      books: document.querySelectorAll('.book').length,
      overlay: !!document.querySelector('nextjs-portal, vite-error-overlay'),
    })`);
    assert.equal(identity.title, "The Reading Room");
    assert.ok(identity.heading);
    assert.ok(identity.books > 0, "the catalogue should render book cards");
    assert.equal(identity.overlay, false, "no framework error overlay should be present");

    const menus = await browser.evaluate(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const root = document.documentElement;
      const sortButton = document.querySelector('#rr-sort-btn');
      const filterButton = document.querySelector('#rr-filter-btn');
      const gear = document.querySelector('#rr-settings-link');
      if (!sortButton || !filterButton || !gear) throw new Error('library chrome is incomplete');

      root.dataset.rrTheme = 'light';
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const iconColours = { light: {
        filter: getComputedStyle(filterButton.querySelector('svg')).stroke,
        sort: getComputedStyle(sortButton.querySelector('svg')).fill,
        settings: getComputedStyle(gear.querySelector('svg')).stroke,
      }};
      root.dataset.rrTheme = 'dark';
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      iconColours.dark = {
        filter: getComputedStyle(filterButton.querySelector('svg')).stroke,
        sort: getComputedStyle(sortButton.querySelector('svg')).fill,
        settings: getComputedStyle(gear.querySelector('svg')).stroke,
      };
      root.dataset.rrTheme = 'light';
      sortButton.click(); await wait(120);
      const sortMenu = document.querySelector('#rr-sort-menu');
      const sortStyle = getComputedStyle(sortMenu);
      const sort = {
        visible: sortMenu.getBoundingClientRect().width > 0,
        background: sortStyle.backgroundColor,
        color: sortStyle.color,
      };
      sortButton.click();

      filterButton.click(); await wait(420);
      const filter = document.querySelector('.catalog .filters');
      const rect = filter.getBoundingClientRect();
      const filters = {
        visible: getComputedStyle(filter).display !== 'none',
        bounded: rect.left >= 0 && rect.right <= innerWidth,
      };
      filterButton.click();

      gear.click();
      for (let n = 0; n < 50 && !document.querySelector('#rr-settings-overlay #close'); n += 1) await wait(100);
      const frame = document.querySelector('#rr-settings-overlay');
      const settings = {
        visible: !!frame?.querySelector('#close'),
        hasAbout: frame?.textContent.includes('About') || false,
      };
      frame?.querySelector('#close')?.click();
      await wait(520);
      settings.closed = !document.querySelector('#rr-settings-overlay');
      return { sort, filters, settings, iconColours };
    })()`);
    assert.equal(menus.sort.visible, true);
    assert.equal(menus.sort.background, "rgba(255, 255, 255, 0.97)");
    assert.equal(menus.sort.color, "rgb(28, 28, 30)");
    assert.deepEqual(menus.filters, { visible: true, bounded: true });
    assert.deepEqual(menus.settings, { visible: true, hasAbout: true, closed: true });
    assert.deepEqual(menus.iconColours, {
      light: { filter: "rgb(38, 51, 47)", sort: "rgb(38, 51, 47)", settings: "rgb(38, 51, 47)" },
      dark: { filter: "rgb(245, 245, 247)", sort: "rgb(245, 245, 247)", settings: "rgb(245, 245, 247)" },
    });
    await browser.screenshot("01-library-menus.png");
  });

  await suite.test("Settings navigation, version and themes remain usable", async () => {
    const result = await browser.evaluate(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const panel = () => document.querySelector('#rr-settings-overlay');
      const row = (label) => [...(panel()?.querySelectorAll('button.rr-settings-row') || [])]
        .find((button) => button.querySelector('strong')?.textContent === label);
      const back = () => panel()?.querySelector('button[aria-label="Back"]')?.click();
      document.querySelector('#rr-settings-link').click();
      for (let n = 0; n < 50 && !row('About'); n += 1) await wait(100);
      if (!row('About')) throw new Error('Settings did not load');
      const headings = [];
      row('Library sources').click(); headings.push(panel()?.querySelector('h1')?.textContent);
      const firstSource = panel()?.querySelector('button.rr-settings-row');
      firstSource?.click(); headings.push(panel()?.querySelector('h1')?.textContent);
      back(); back();
      row('Library maintenance').click(); headings.push(panel()?.querySelector('h1')?.textContent);
      back(); row('Metadata & artwork').click(); headings.push(panel()?.querySelector('h1')?.textContent);
      back(); row('Appearance').click(); headings.push(panel()?.querySelector('h1')?.textContent);
      row('Dark').click(); await wait(100);
      const dark = { theme: document.documentElement.dataset.rrTheme,
        background: getComputedStyle(panel()).backgroundColor,
        text: getComputedStyle(panel()).color };
      row('Light').click(); await wait(100);
      const light = { theme: document.documentElement.dataset.rrTheme,
        background: getComputedStyle(panel()).backgroundColor,
        text: getComputedStyle(panel()).color };
      back(); row('About').click(); headings.push(panel()?.querySelector('h1')?.textContent);
      const version = [...panel().querySelectorAll('.rr-settings-row')]
        .find((item) => item.querySelector('strong')?.textContent === 'Version')
        ?.querySelector('.rr-settings-value')?.textContent;
      back(); panel()?.querySelector('#close')?.click();
      await wait(520);
      return { headings, dark, light, version, closed: !panel() };
    })()`);
    assert.deepEqual(result.headings.slice(0, 1), ["Library sources"]);
    assert.ok(result.headings.includes("Library maintenance"));
    assert.ok(result.headings.includes("Metadata & artwork"));
    assert.ok(result.headings.includes("Appearance"));
    assert.ok(result.headings.includes("About"));
    assert.deepEqual(result.dark, { theme: "dark", background: "rgb(0, 0, 0)", text: "rgb(245, 245, 247)" });
    assert.deepEqual(result.light, { theme: "light", background: "rgb(255, 255, 255)", text: "rgb(28, 28, 30)" });
    assert.match(result.version || "", /^\d+$/);
    assert.equal(result.closed, true);
    await browser.screenshot("01b-settings-parity.png");
  });

  await suite.test("a readable book opens and reader settings persist", async () => {
    const result = await browser.evaluate(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const search = document.querySelector('.hero .search input');
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setValue.call(search, 'Complete Works of William Trevor');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(600);
      const readable = [...document.querySelectorAll('.book .cover, .shelf-book')]
        .find((button) => /William Trevor/i.test(button.getAttribute('title') || button.getAttribute('aria-label') || button.textContent));
      if (!readable) throw new Error('no readable book control found');
      readable.click();
      for (let n = 0; n < 80 && !document.querySelector('.reader-shell'); n += 1) {
        const edition = document.querySelector('.rr-edition-list button');
        const readHere = [...document.querySelectorAll('.modal button')]
          .find((button) => button.textContent.trim() === 'Read here');
        if (edition) edition.click();
        else if (readHere) readHere.click();
        await wait(100);
      }
      if (!document.querySelector('.reader-shell')) throw new Error('reader did not open');
      const trigger = document.querySelector('.rr-react-sheet-trigger');
      trigger?.click(); await wait(250);
      const sheet = document.querySelector('section[role="dialog"][data-book-theme]');
      if (!sheet) throw new Error('reading menu did not open');
      const tile = (label) => [...sheet.querySelectorAll('button')].find((button) =>
        [...button.querySelectorAll('span')].some((span) => span.textContent.trim() === label));
      tile('Text')?.click(); await wait(100);
      const dark = sheet.querySelector('button[title="Dark"]');
      dark?.click(); await wait(180);
      const darkApplied = document.querySelector('.reader-shell')?.classList.contains('reader-theme-dark');
      const pages = [...sheet.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Pages');
      const scroll = [...sheet.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Scroll');
      if (!scroll) throw new Error('William Trevor title did not open as a reflowable book');
      pages?.click(); await wait(700);
      const currentSheet = [...document.querySelectorAll('section[role="dialog"][data-book-theme]')].at(-1);
      [...(currentSheet?.querySelectorAll('button') || [])]
        .find((button) => button.textContent.trim() === 'Scroll')?.click();
      await wait(1200);
      const mode = localStorage.getItem('reading-room-reader-mode');
      sheet.querySelector('button[aria-label="Back to reading menu"]')?.click(); await wait(120);
      return { darkApplied, mode, menuOpen: document.documentElement.classList.contains('rr-react-sheet-open') };
    })()`);
    assert.equal(result.darkApplied, true, "dark reading theme should affect the reader");
    assert.equal(result.mode, "scroll", "scroll mode should persist");
    assert.equal(result.menuOpen, true, "back should return to the reading menu");
    await browser.screenshot("02-reader-theme.png");
  });

  await suite.test("search, bookmarks and narration controls are reachable", async () => {
    const result = await browser.evaluate(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const sheet = () => document.querySelector('section[role="dialog"][data-book-theme]');
      const tile = (label) => [...sheet().querySelectorAll('button')].find((button) =>
        [...button.querySelectorAll('span')].some((span) => span.textContent.trim() === label));
      const panels = {};
      for (const [label, aria, key] of [['Search', 'Search inside book', 'search'], ['Marks', 'Bookmarks', 'bookmarks']]) {
        tile(label)?.click();
        let panel = null;
        for (let n = 0; n < 20 && !panel; n += 1) { await wait(50); panel = document.querySelector('aside[aria-label="' + aria + '"]'); }
        const back = panel?.querySelector('button[aria-label="Back to reading menu"]');
        panels[key] = !!panel && !!back;
        back?.click();
        for (let n = 0; n < 20 && !document.documentElement.classList.contains('rr-react-sheet-open'); n += 1) await wait(50);
        await wait(380);
        panels[key + 'Returned'] = document.documentElement.classList.contains('rr-react-sheet-open');
      }
      tile('Aloud')?.click(); await wait(120);
      let aloud = sheet();
      const start = [...aloud.querySelectorAll('button')].find((button) => button.textContent.includes('Start reading'));
      start?.click();
      for (let n = 0; n < 100 && !sheet()?.querySelector('button[aria-label="Pause reading"], button[aria-label="Resume reading"]'); n += 1) await wait(100);
      aloud = sheet();
      const state = {
        panels,
        start: !!start,
        previous: !!aloud.querySelector('button[aria-label="Previous sentence"]'),
        pause: !!aloud.querySelector('button[aria-label="Pause reading"], button[aria-label="Resume reading"]'),
        next: !!aloud.querySelector('button[aria-label="Next sentence"]'),
        sleepMinus: !!aloud.querySelector('button[aria-label="Subtract 30 minutes"]'),
        sleepPlus: !!aloud.querySelector('button[aria-label="Add 30 minutes"]'),
      };
      [...aloud.querySelectorAll('button')].find((button) => button.textContent.includes('Stop reading'))?.click();
      return {
        ...state,
      };
    })()`);
    assert.deepEqual(result.panels, {
      search: true,
      searchReturned: true,
      bookmarks: true,
      bookmarksReturned: true,
    });
    assert.equal(result.start, true);
    assert.equal(result.previous, true);
    assert.equal(result.pause, true);
    assert.equal(result.next, true);
    assert.equal(result.sleepMinus, true);
    assert.equal(result.sleepPlus, true);
    await browser.screenshot("03-narration-controls.png");
  });

  await suite.test("scroll mode moves the visible reading viewport", async () => {
    const movement = await browser.evaluate(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      document.querySelector('button[aria-label="Back to reading menu"]')?.click();
      document.querySelector('.rr-react-sheet-trigger')?.click();
      await wait(180);
      const scroller = document.querySelector('.epub-container, .pdf-scroll, .comic-scroll');
      if (!scroller) return { supported: false };
      const before = scroller.scrollTop;
      scroller.scrollTo({ top: before + Math.max(200, scroller.clientHeight / 2), behavior: 'auto' });
      await wait(120);
      return { supported: true, before, after: scroller.scrollTop };
    })()`);
    assert.equal(movement.supported, true, "the opened title should expose a reader scroller");
    assert.ok(movement.after > movement.before, "the visible reader viewport should scroll");
  });

  assert.deepEqual(consoleProblems, [], `browser errors: ${consoleProblems.join("\n")}`);
});
