import { listCollections } from "@/server/collections";
import { libraryStats } from "@/server/saves";
import { listTags } from "@/server/tags";
import { getAiSettings } from "@/server/settings";
import { AppProvider } from "@/components/app-context";
import { Sidebar } from "@/components/sidebar";
import { CommandPalette } from "@/components/command-palette";
import { QuickSave } from "@/components/quick-save";
import { SaveDetailSheet } from "@/components/save-detail";
import { CollectionDialog } from "@/components/collection-dialog";
import { Toaster } from "@/components/toaster";
import { Shortcuts } from "@/components/shortcuts";

// Every page reads the local database at request time; nothing is prerendered at build.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [collections, stats, tags, ai] = await Promise.all([
    listCollections(),
    libraryStats(),
    listTags(),
    getAiSettings(),
  ]);
  return (
    <AppProvider
      collections={collections}
      tags={tags.map((t) => t.name)}
      aiEnabled={ai.provider !== "none"}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-1.5 focus:text-on-accent"
      >
        Skip to content
      </a>
      <Sidebar counts={stats} />
      <main id="main" className="min-h-dvh md:py-2 md:pr-2 md:pl-60">
        <div className="min-h-dvh bg-panel md:min-h-[calc(100dvh-16px)] md:overflow-hidden md:rounded-xl md:border md:border-border md:shadow-[inset_0_1px_0_0_var(--color-card-highlight)]">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 md:py-8 lg:px-10">
            {children}
          </div>
        </div>
      </main>
      <CommandPalette />
      <QuickSave />
      <SaveDetailSheet />
      <CollectionDialog />
      <Toaster />
      <Shortcuts />
    </AppProvider>
  );
}
