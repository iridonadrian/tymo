// Runs the Tymo server as a child of the app, and stops it when the app goes away, even
// if the app was killed rather than quit.
process.on("disconnect", () => process.exit(0));
require(process.env.TYMO_SERVER_ENTRY);
