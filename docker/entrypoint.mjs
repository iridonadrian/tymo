// Refuses to expose an unauthenticated (or trivially guessable) library by accident.
const exposed = !["127.0.0.1", "localhost", "::1"].includes(process.env.HOSTNAME ?? "");
const password = process.env.TYMO_PASSWORD ?? "";
if (exposed && !password && process.env.TYMO_ALLOW_NO_AUTH !== "1") {
  console.error(
    "[tymo] Refusing to start: listening on all interfaces without TYMO_PASSWORD.\n" +
      "       Set TYMO_PASSWORD, or set TYMO_ALLOW_NO_AUTH=1 if the port is only published to localhost.",
  );
  process.exit(1);
}
if (exposed && password && password.length < 8) {
  console.error(
    "[tymo] Refusing to start: TYMO_PASSWORD is shorter than 8 characters.\n" +
      "       Use a long passphrase (12+ characters), e.g. four random words.",
  );
  process.exit(1);
}
if (!password)
  console.warn(
    "[tymo] No TYMO_PASSWORD set: anyone who can reach this port can read your library.",
  );
else if (password.length < 12)
  console.warn("[tymo] TYMO_PASSWORD is short; a 12+ character passphrase is recommended.");
await import("./apps/web/server.js");
