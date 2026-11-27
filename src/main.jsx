import { handleWindowClose } from './features/note-edit/editorFlush';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, Link, NavLink, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { NotebookPen } from 'lucide-react';
import { ToastProvider } from './dumb/Toasts';
import { Notes } from './pages/notes/Notes';
import { Practice } from './pages/practice/Practice';
import { Inbox } from './pages/inbox/Inbox';
import { Sources } from './pages/sources/Sources';
import { Zettelkasten } from './pages/zettelkasten/Zettelkasten';
import { Account } from './pages/account/Account';
import './dumb/style.css';

function Frame() {
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    window.addEventListener('replica-change', changed);
    return () => window.removeEventListener('replica-change', changed);
  }, [changed]);
  return <ToastProvider>
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-base-100">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-base-300 bg-base-100 px-4 py-2 md:px-6">
        <Link to="/notes" className="flex items-center gap-2 text-lg font-semibold"><NotebookPen size={20} /> Gestalter</Link>
        <nav className="flex flex-wrap gap-1" aria-label="Workspace">
          <NavLink to="/notes" className="nav-link">Notes</NavLink>
          <NavLink to="/zettelkasten" className="nav-link">Zettelkasten</NavLink>
          <NavLink to="/sources" className="nav-link">Academic Sources</NavLink>
          <NavLink to="/inbox" className="nav-link">Plaintext inbox</NavLink>
          <NavLink to="/practice" className="nav-link">Recent practice</NavLink>
          <NavLink to="/account" className="nav-link">Account</NavLink>
        </nav>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto"><Outlet context={{ revision, changed }} /></div>
    </div>
  </ToastProvider>;
}

const router = createHashRouter([{
  element: <Frame />,
  children: [
    { index: true, element: <Navigate to="/notes" replace /> },
    { path: 'notes/:id?', element: <Notes /> },
    { path: 'zettelkasten/:id?', element: <Zettelkasten /> },
    { path: 'inbox/:itemId?/:id?', element: <Inbox /> },
    { path: 'sources/:id?/:noteId?', element: <Sources /> },
    { path: 'account', element: <Account /> },
    { path: 'practice', element: <Practice /> },
    { path: '*', element: <Navigate to="/notes" replace /> },
  ],
}]);

handleWindowClose();
createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
