'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '../..');
const filename = 'House_of_Kiran_AI_Stage3_6_PRODUCTION.html';

function loadPage({ query = '', beforeParse, directory = root } = {}) {
  // Execute the shipped scripts in a DOM, without fetching any external assets.
  const html = fs.readFileSync(path.join(directory, filename), 'utf8').replace(/<script src="([^"]+)"><\/script>/g,
    (_, file) => `<script>${fs.readFileSync(path.join(directory, file), 'utf8')}</script>`);
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  let now = 0;
  let nextId = 0;
  const tasks = new Map();
  const dom = new JSDOM(html, {
    url: `https://appassets.androidplatform.net/assets/game/${filename}${query}`,
    runScripts: 'dangerously', virtualConsole, pretendToBeVisual: true,
    beforeParse(window) {
      const schedule = (callback, delay, repeat, args) => {
        const id = ++nextId;
        tasks.set(id, { callback, time: now + Math.max(1, delay || 0), repeat, args });
        return id;
      };
      window.setTimeout = (callback, delay, ...args) => schedule(callback, delay, 0, args);
      window.setInterval = (callback, delay, ...args) => schedule(callback, delay, Math.max(1, delay || 0), args);
      window.clearTimeout = window.clearInterval = id => tasks.delete(id);
      window.requestAnimationFrame = callback => schedule(() => callback(now), 16, 0, []);
      window.cancelAnimationFrame = window.clearTimeout;
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
      if (beforeParse) beforeParse(window);
    }
  });
  return {
    window: dom.window, document: dom.window.document, errors,
    state: () => dom.window.HOKOnlineBridge.getState(),
    advance(ms) {
      const end = now + ms;
      let count = 0;
      while (true) {
        const entry = [...tasks].filter(([, task]) => task.time <= end).sort((a, b) => a[1].time - b[1].time)[0];
        if (!entry) break;
        if (++count > 10000) throw new Error('Page timer loop');
        const [id, task] = entry;
        now = task.time;
        if (task.repeat) task.time += task.repeat; else tasks.delete(id);
        task.callback(...task.args);
      }
      now = end;
    },
    close() { tasks.clear(); dom.window.close(); }
  };
}

module.exports = { loadPage, root };
