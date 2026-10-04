// Fake only the documented line protocol; production tests also use real Piper.
import { createInterface } from "node:readline";
const input = createInterface({ input: process.stdin });
input.on("line", line => {
  const { text, output_file } = JSON.parse(line);
  if (text === "crash") process.exit(42);
  if (text === "hang") return;
  setTimeout(() => process.stdout.write(output_file + "\n"), text === "slow" ? 60 : 1);
});
