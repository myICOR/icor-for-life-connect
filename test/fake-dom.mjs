/* The fake DOM the plugin gates run against.
 *
 * Extracted from toolbar-buttons.test.mjs on 2026-08-31, when the banner gate
 * needed the same element tree. One copy: a selector engine that quietly
 * disagrees with itself between two gates is worse than no gate in either.
 */

/* ------------------------------------------------------------------ DOM --
 * Just enough DOM for the toolbar paths: an element tree, class lists,
 * attributes, and a selector engine that understands what main.js actually
 * asks for - `.class` steps, `[attr="value"]` steps, compounds of the two,
 * the descendant combinator, and comma lists. Anything fancier returns no
 * match, which is exactly what a missing surface looks like to the plugin. */

class FakeEl {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attrs = Object.create(null);
    this.classSet = new Set();
    this.handlers = Object.create(null);
    this.dataset = Object.create(null);
    this.textContent = '';
    this.innerHTML = '';
  }
  get classList() {
    const s = this.classSet;
    return {
      add: (...c) => { for (const x of c) s.add(x); },
      remove: (...c) => { for (const x of c) s.delete(x); },
      toggle: (c, force) => {
        const on = force === undefined ? !s.has(c) : !!force;
        if (on) s.add(c); else s.delete(c);
        return on;
      },
      contains: (c) => s.has(c),
    };
  }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addClass(c) { this.classSet.add(c); }
  appendChild(node) {
    if (node.parentElement) node.parentElement.removeChild(node);
    node.parentElement = this;
    this.children.push(node);
    return node;
  }
  insertBefore(node, ref) {
    if (!ref) return this.appendChild(node);
    if (node.parentElement) node.parentElement.removeChild(node);
    const i = this.children.indexOf(ref);
    node.parentElement = this;
    this.children.splice(i < 0 ? this.children.length : i, 0, node);
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) { this.children.splice(i, 1); node.parentElement = null; }
    return node;
  }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  addEventListener(type, fn) { (this.handlers[type] || (this.handlers[type] = [])).push(fn); }
  /* Returns the event, so a gate can ask whether the handler claimed the
     click. A handler that leaves the default alone on an <a href> lets the
     host follow the link as well, and the page opens twice. */
  click() {
    const ev = {
      defaultPrevented: false,
      stopPropagation() {},
      preventDefault() { ev.defaultPrevented = true; },
    };
    for (const fn of this.handlers.click || []) fn(ev);
    return ev;
  }
  prepend(node) {
    return this.insertBefore(node, this.children[0] || null);
  }
  createDiv(opts) { return this.appendChild(makeEl('div', opts)); }
  createSpan(opts) { return this.appendChild(makeEl('span', opts)); }
  createEl(tag, opts) { return this.appendChild(makeEl(tag, opts)); }
  * walk() {
    for (const child of this.children) { yield child; yield* child.walk(); }
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    for (const alternative of String(sel).split(',')) {
      const chain = alternative.trim().split(/\s+/).filter(Boolean);
      if (chain.some((step) => step.includes('>') || step.includes(':'))) continue;
      for (const el of this.walk()) {
        if (!matches(el, chain[chain.length - 1])) continue;
        let cursor = el.parentElement;
        let ok = true;
        for (let i = chain.length - 2; i >= 0; i--) {
          while (cursor && cursor !== this.parentElement && !matches(cursor, chain[i])) cursor = cursor.parentElement;
          if (!cursor || cursor === this.parentElement) { ok = false; break; }
          cursor = cursor.parentElement;
        }
        if (ok && !out.includes(el)) out.push(el);
      }
    }
    return out;
  }
}

function matches(el, simple) {
  const parts = simple.match(/\.[\w-]+|\[[\w-]+="[^"]*"\]|^[a-zA-Z][\w-]*/g) || [];
  if (parts.length === 0) return false;
  for (const p of parts) {
    if (p.startsWith('.')) { if (!el.classSet.has(p.slice(1))) return false; }
    else if (p.startsWith('[')) {
      const m = /^\[([\w-]+)="([^"]*)"\]$/.exec(p);
      if (!m || el.attrs[m[1]] !== m[2]) return false;
    } else if (el.tagName !== p.toUpperCase()) return false;
  }
  return true;
}

function makeEl(tag, opts = {}) {
  const el = new FakeEl(tag);
  if (opts.cls) for (const c of String(opts.cls).split(/\s+/).filter(Boolean)) el.classSet.add(c);
  if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) el.attrs[k] = String(v);
  if (opts.text) el.textContent = String(opts.text);
  return el;
}
export { FakeEl, matches, makeEl };
