import { useEffect, useRef } from 'react';
import { autocompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { drawSelection, EditorView, keymap, placeholder } from '@codemirror/view';

export function MarkdownEditor({ value, label, hint, compact, onChange, onBlur, onFiles, onOpen, search }) {
  const host = useRef(null);
  const view = useRef(null);
  const handlers = useRef({});
  handlers.current = { onChange, onBlur, onFiles, onOpen, search };

  useEffect(() => {
    const receiveFiles = (event, files) => {
      if (!files?.length || !handlers.current.onFiles) return false;
      event.preventDefault();
      handlers.current.onFiles(Array.from(files));
      return true;
    };
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          EditorView.cspNonce.of(document.querySelector('meta[name=gestalter-style-nonce]')?.content ?? ''),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown(),
          placeholder(hint),
          keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
          autocompletion({ override: [(context) => {
            const match = context.matchBefore(/\[\[[^\]\n|]*/);
            if (!match || !handlers.current.search) return null;
            return {
              from: match.from + 2,
              filter: false,
              options: handlers.current.search(match.text.slice(2)).map(({ id, title }) => ({
                label: title,
                apply: id + ']]',
              })),
            };
          }] }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            blur: () => { handlers.current.onBlur?.(); return false; },
            paste: (event) => receiveFiles(event, event.clipboardData?.files),
            drop: (event) => receiveFiles(event, event.dataTransfer?.files),
            click(event, view) {
              if (!(event.ctrlKey || event.metaKey) || !handlers.current.onOpen) return false;
              const position = view.posAtCoords(event);
              if (position == null) return false;
              const line = view.state.doc.lineAt(position);
              const offset = position - line.from;
              for (const match of line.text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
                if (offset < match.index || offset >= match.index + match[0].length) continue;
                handlers.current.onOpen(match[1]);
                return true;
              }
              return false;
            },
          }),
        ],
      }),
    });
    view.current = editor;
    return () => { view.current = null; editor.destroy(); };
  }, [label, hint]);

  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className={`rounded-md border border-base-300 font-mono focus-within:border-primary
    [&_.cm-content]:p-2 ${compact ? '[&_.cm-content]:min-h-12' : '[&_.cm-content]:min-h-24'}`} />;
}
