import { cookies, headers } from "next/headers";
import { ACCENT_COOKIE, parseAccent } from "@/lib/accent";
import { listApiTokens } from "@/server/tokens";
import { getAiSettingsPublic } from "@/server/settings";
import { libraryStats } from "@/server/saves";
import { pendingCount } from "@/server/enrich";
import { embeddingStatus } from "@/server/embeddings";
import { getArchiveSettings } from "@/server/archive";
import { backupsDir, getBackupSettings, listBackups } from "@/server/backup";
import { brokenCount, getLinkCheckSettings } from "@/server/linkcheck";
import { authEnabled } from "@/server/auth";
import { config } from "@/server/config";
import { displayPath } from "@/server/privacy";
import { PageHeader } from "@/components/ui";
import {
  AiSettingsForm,
  ArchiveSettingsForm,
  BackupPanel,
  Bookmarklet,
  ExportLinks,
  ExtensionTokens,
  ImportForm,
  LinkCheckForm,
  ThemePicker,
  AccentPicker,
  LogoutButton,
  McpConnector,
} from "@/components/settings-client";
import { listConnectedApps, publicOrigin } from "@/server/oauth";

export const metadata = { title: "Settings" };

function Card({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="card scroll-mt-6">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-fg-2">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const [tokens, ai, stats, pending, embeddings, archive, backup, backups, linkCheck, broken] =
    await Promise.all([
      listApiTokens(),
      getAiSettingsPublic(),
      libraryStats(),
      pendingCount(),
      embeddingStatus(),
      getArchiveSettings(),
      getBackupSettings(),
      listBackups(),
      getLinkCheckSettings(),
      brokenCount(),
    ]);
  const h = await headers();
  const themeCookie = (await cookies()).get("tymo_theme")?.value;
  const theme = themeCookie === "light" || themeCookie === "dark" ? themeCookie : "system";
  const accent = parseAccent((await cookies()).get(ACCENT_COOKIE)?.value);
  const origin = publicOrigin(h);
  const apps = await listConnectedApps();
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Configuration" title="Settings" />
      <div className="space-y-5">
        <Card
          title="Appearance"
          description="System follows your operating system's light/dark setting. The accent colours buttons, links and highlights; the code-field glow stays blue."
        >
          <div className="space-y-5">
            <ThemePicker initial={theme} />
            <div>
              <div className="eyebrow mb-2">Accent colour</div>
              <AccentPicker initial={accent} />
            </div>
          </div>
        </Card>
        <Card
          title="Browser extension"
          description="Connect the Tymo extension for Chromium browsers or Firefox. Tokens are shown once and stored hashed."
        >
          <ExtensionTokens tokens={tokens} origin={origin} />
          <div className="mt-5 border-t border-border pt-4">
            <Bookmarklet origin={origin} />
          </div>
        </Card>
        <Card
          id="mcp"
          title="AI assistants (MCP)"
          description="Let Claude search your library, read saves and add links, notes and highlights. Anything you connect can be disconnected here; nothing can delete saves."
        >
          <McpConnector url={`${origin}/mcp`} passwordSet={authEnabled()} apps={apps} />
        </Card>
        <Card
          id="import"
          title="Import"
          description="Browser bookmarks (HTML from Chrome, Edge, Brave, Firefox or Safari), Pocket, Raindrop.io or Instapaper CSV, Pinboard JSON, a Tymo export, or any CSV with a URL column. The format is detected automatically; folders become collections. Imports never fetch pages."
        >
          <ImportForm />
        </Card>
        <Card
          id="export"
          title="Export"
          description="Your data is yours. Download everything, any time."
        >
          <ExportLinks />
        </Card>
        <Card
          id="backup"
          title="Backup & restore"
          description={
            process.env.TYMO_BACKUP_DIR
              ? "One file with everything, including files. Daily backups go to the folder below, outside the data folder. Restoring replaces the current library; the old data is kept aside."
              : "One file with everything, including files. Restoring replaces the current library; the old data is kept aside in the data folder. Tip: set TYMO_BACKUP_DIR to an iCloud Drive, Dropbox or external-disk folder so daily copies also live off this computer (the Mac installer does this for you)."
          }
        >
          <BackupPanel
            auto={backup.auto}
            keep={backup.keep}
            backups={backups.slice(0, 10)}
            dir={displayPath(backupsDir())}
          />
        </Card>
        <Card
          id="archive"
          title="Page archiving"
          description="Keep a private, offline copy of saved pages in case they change or disappear. Archives contain the page's HTML, styles and images, never scripts. Use “Archive page” on any save, or turn it on for everything."
        >
          <div className="space-y-4">
            <ArchiveSettingsForm auto={archive.auto} />
            <LinkCheckForm auto={linkCheck.auto} broken={broken} />
          </div>
        </Card>
        <Card
          id="ai"
          title="AI (optional)"
          description="Off by default. When enabled, a save's title, URL and up to 6,000 characters of page text are sent to the provider you configure. Suggestions are never applied without your review."
        >
          <AiSettingsForm initial={ai} embeddings={embeddings} />
        </Card>
        <Card title="About & privacy">
          <dl className="grid grid-cols-[160px_1fr] gap-y-2 font-mono text-2xs">
            <dt className="text-muted">VERSION</dt>
            <dd className="text-fg-2">{config.version}</dd>
            <dt className="text-muted">DATA DIRECTORY</dt>
            <dd className="break-all text-fg-2">{displayPath(config.dataDir)}</dd>
            <dt className="text-muted">LIBRARY</dt>
            <dd className="text-fg-2">
              {stats.saves} saves · {stats.archived} archived · {stats.collections} collections ·{" "}
              {stats.sessions} sessions
            </dd>
            <dt className="text-muted">METADATA QUEUE</dt>
            <dd className="text-fg-2">{pending} pending</dd>
            <dt className="text-muted">TELEMETRY</dt>
            <dd className="text-fg-2">None. Tymo never phones home.</dd>
            <dt className="text-muted">AUTH</dt>
            <dd className="text-fg-2">
              {authEnabled() ? "Password gate enabled" : "Local mode (no password)"}
            </dd>
          </dl>
          {authEnabled() && (
            <div className="mt-4">
              <LogoutButton />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
