import { readFileSync } from "node:fs";

export const pictureBytes = Uint8Array.from(readFileSync("tests/fixtures/picture.png"));
