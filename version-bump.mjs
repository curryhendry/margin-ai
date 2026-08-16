import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const version = process.env.npm_package_version;

if (!version) {
  console.error("Could not determine version from npm_package_version");
  process.exit(1);
}

const pluginJsonPath = "manifest.json";
const versionsJsonPath = "versions.json";

try {
  const manifest = JSON.parse(readFileSync(pluginJsonPath, "utf8"));
  manifest.version = version;
  writeFileSync(pluginJsonPath, JSON.stringify(manifest, null, "\t") + "\n");

  const versions = JSON.parse(readFileSync(versionsJsonPath, "utf8"));
  versions[version] = manifest.minAppVersion;
  writeFileSync(versionsJsonPath, JSON.stringify(versions, null, "\t") + "\n");

  execSync(`git add ${pluginJsonPath} ${versionsJsonPath}`, {
    stdio: "inherit",
  });
} catch (e) {
  console.error(e);
  process.exit(1);
}
