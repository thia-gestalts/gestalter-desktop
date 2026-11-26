import Markdown from 'react-markdown';

export function InlineMarkdown({ children }) {
  return <Markdown skipHtml allowedElements={['em', 'strong', 'code', 'del']} unwrapDisallowed>
    {children}
  </Markdown>;
}
