import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Each test file gets its own data dir: some tests move DATA_DIR/files around (restore).
process.env.TYMO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tymo-test-"));
