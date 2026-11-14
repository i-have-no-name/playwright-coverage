import { ChatPanel } from './components/ChatPanel';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { useShortcuts } from './hooks/useShortcuts';

export function App() {
  useShortcuts();

  return (
    <>
      <Header />
      <Sidebar />
      <ChatPanel />
      <Footer />
    </>
  );
}
