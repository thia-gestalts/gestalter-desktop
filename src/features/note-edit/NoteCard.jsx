import Markdown from 'react-markdown';
import { useRead } from '../../entities/workspace/useRead';

const content = (value) => typeof value === 'string' && value.trim();

function Attachment({ image }) {
  const { value } = useRead('getImage', image.id);
  return value ? <img src={value} alt={image.name ?? ''} className="max-h-96 object-contain" /> : null;
}

export function NoteCard({ note }) {
  return <article className="flex flex-col gap-3">
    {content(note.title) && <h2 className="text-xl font-semibold">{note.title}</h2>}
    {content(note.text) && <div className="markdown"><Markdown skipHtml>{note.text}</Markdown></div>}
    {content(note.extra) && <div className="markdown text-sm text-base-content/70"><Markdown skipHtml>{note.extra}</Markdown></div>}
    {note.attachments?.map((image) => <Attachment key={image.id} image={image} />)}
  </article>;
}
