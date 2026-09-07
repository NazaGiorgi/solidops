// This layout file only provides the required default export for the (app)
// route-group. The app shell (sidebar + main frame) lives in ./shell.tsx
// because Next.js route-group layouts must not export custom components
// (route type-checking rejects extra exports). Each (app) page wraps itself
// in <Shell>; this layout passes children through untouched to avoid
// double-rendering the sidebar frame.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}