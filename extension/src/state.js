// state.js — Central mutable state for the content script
//
// esbuild's IIFE format inlines module scopes, so ESM live bindings
// (export let) may not survive bundling. Getter/setter functions
// always work because function calls go through the closure.

// ─── Core UI ────────────────────────────────────────────────────
let _panelOpen = false;
let _panelRoot = null;
let _shadowRoot = null;
let _toggleBtnRef = null;
let _lazyInitDone = false;

export function getPanelOpen() { return _panelOpen; }
export function setPanelOpen(v) { _panelOpen = v; }

export function getPanelRoot() { return _panelRoot; }
export function setPanelRoot(v) { _panelRoot = v; }

export function getShadowRoot() { return _shadowRoot; }
export function setShadowRoot(v) { _shadowRoot = v; }

export function getToggleBtnRef() { return _toggleBtnRef; }
export function setToggleBtnRef(v) { _toggleBtnRef = v; }

export function getLazyInitDone() { return _lazyInitDone; }
export function setLazyInitDone(v) { _lazyInitDone = v; }

// ─── Analysis ───────────────────────────────────────────────────
let _currentAnalysis = null;

export function getCurrentAnalysis() { return _currentAnalysis; }
export function setCurrentAnalysis(v) { _currentAnalysis = v; }

// ─── Autofill ───────────────────────────────────────────────────
let _pendingAnswers = null;
let _pendingQuestions = null;
let _fieldMap = {};

export function getPendingAnswers() { return _pendingAnswers; }
export function setPendingAnswers(v) { _pendingAnswers = v; }

export function getPendingQuestions() { return _pendingQuestions; }
export function setPendingQuestions(v) { _pendingQuestions = v; }

export function getFieldMap() { return _fieldMap; }
export function setFieldMap(v) { _fieldMap = v; }
