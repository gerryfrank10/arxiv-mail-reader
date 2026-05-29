// A CodeMirror 6 based Markdown editor that renders structure *live* — headings
// at real sizes, bold/italic/code styled, syntax markers dimmed — while the
// document underneath stays plain Markdown. The parent drives it as a
// controlled value and reaches in through an imperative handle for AI splicing,
// citation insertion and selection-popover positioning.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, drawSelection, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, indentOnInput, defaultHighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export interface MarkdownEditorHandle {
  getSelection(): { start: number; end: number; text: string };
  splice(start: number, end: number, text: string): void;
  focus(): void;
  coordsAtSelection(): { x: number; y: number } | null;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSelectionChange?: (hasSelection: boolean) => void;
  onMouseUp?: () => void;
  onScroll?: () => void;
  placeholder?: string;
}

// Live-render style: real heading sizes, dimmed syntax markers, styled inline.
const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.7em', fontWeight: '700', lineHeight: '1.3' },
  { tag: t.heading2, fontSize: '1.4em', fontWeight: '700', lineHeight: '1.3' },
  { tag: t.heading3, fontSize: '1.18em', fontWeight: '600' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', background: '#f1f5f9', color: '#be123c', borderRadius: '3px', padding: '0 2px' },
  { tag: [t.link, t.url], color: '#7c3aed' },
  { tag: t.quote, color: '#64748b', fontStyle: 'italic' },
  { tag: t.list, color: '#7c3aed' },
  // The literal syntax punctuation (#, **, -, >, backticks) — dim it, Typora-style.
  { tag: [t.processingInstruction, t.meta], color: '#cbd5e1' },
]);

const editorTheme = EditorView.theme({
  '&': { height: 'auto', backgroundColor: 'transparent', color: '#1e293b' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'visible', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.65' },
  '.cm-content': { padding: '2rem 2rem 4rem', caretColor: '#7c3aed', fontSize: '15px' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: '#7c3aed', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#ddd6fe' },
  '.cm-placeholder': { color: '#94a3b8' },
});

const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(
  { value, onChange, onSelectionChange, onMouseUp, onScroll, placeholder }, ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Keep the latest callbacks reachable from CM extensions without re-creating the view.
  const cb = useRef({ onChange, onSelectionChange, onMouseUp, onScroll });
  cb.current = { onChange, onSelectionChange, onMouseUp, onScroll };

  useImperativeHandle(ref, (): MarkdownEditorHandle => ({
    getSelection() {
      const v = viewRef.current;
      if (!v) return { start: value.length, end: value.length, text: '' };
      const r = v.state.selection.main;
      return { start: r.from, end: r.to, text: v.state.sliceDoc(r.from, r.to) };
    },
    splice(start, end, text) {
      const v = viewRef.current;
      if (!v) return;
      v.dispatch({ changes: { from: start, to: end, insert: text }, selection: { anchor: start + text.length } });
      v.focus();
    },
    focus() { viewRef.current?.focus(); },
    coordsAtSelection() {
      const v = viewRef.current;
      if (!v) return null;
      const c = v.coordsAtPos(v.state.selection.main.from);
      return c ? { x: c.left, y: c.top } : null;
    },
  }), [value]);

  // Build the view once.
  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        drawSelection(),
        indentOnInput(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: [] }),
        syntaxHighlighting(mdHighlight),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        placeholder ? cmPlaceholder(placeholder) : [],
        editorTheme,
        EditorView.updateListener.of(u => {
          if (u.docChanged) cb.current.onChange(u.state.doc.toString());
          if (u.selectionSet || u.docChanged) {
            const r = u.state.selection.main;
            cb.current.onSelectionChange?.(r.from !== r.to);
          }
        }),
        EditorView.domEventHandlers({
          mouseup: () => { cb.current.onMouseUp?.(); return false; },
          scroll:  () => { cb.current.onScroll?.(); return false; },
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Controlled sync: only push when an *external* change diverges from the doc
  // (typing/AI edits already round-trip through onChange, so this is a no-op for them).
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (value !== current) {
      v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={hostRef} className="cm-host" />;
});

export default MarkdownEditor;
