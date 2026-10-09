// Builds the portable Windows x64 app into dist/ (works from Windows, macOS or Linux).
//   npm run pack:win
import { packager } from '@electron/packager';
import * as ResEdit from 'resedit';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = 'Mondiro MagicForge';

const [outDir] = await packager({
  dir: root,
  out: path.join(root, 'dist'),
  name,
  executableName: name,
  platform: 'win32',
  arch: 'x64',
  overwrite: true,
  asar: true,
  prune: true,
  ignore: [/^\/dist($|\/)/, /^\/build($|\/)/, /^\/\.git/, /^\/\.github/, /^\/docs($|\/)/],
});

// Set the .exe icon and version info without needing Wine (pure JS resource editing).
const exePath = path.join(outDir, `${name}.exe`);
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, 'assets', 'icon.ico')));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const gid = groups.length ? groups[0].id : 1;
const lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map(i => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
const ver = pkg.version.split('.').map(Number);
vi.setFileVersion(ver[0], ver[1], ver[2], 0, 1033);
vi.setProductVersion(ver[0], ver[1], ver[2], 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  FileDescription: name,
  ProductName: name,
  CompanyName: 'Mondiro',
  LegalCopyright: 'Created by Mondiro',
  OriginalFilename: `${name}.exe`,
  InternalName: name,
});
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('Packaged:', outDir);

// Zip it (zip on Linux/macOS, PowerShell on Windows).
const zipPath = path.join(root, 'dist', `MondiroMagicForge-${pkg.version}-win-x64.zip`);
fs.rmSync(zipPath, { force: true });
try {
  if (process.platform === 'win32') {
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${outDir}' -DestinationPath '${zipPath}'"`);
  } else {
    execSync(`zip -qry -9 "${zipPath}" "${path.basename(outDir)}"`, { cwd: path.dirname(outDir) });
  }
  console.log('Zip:', zipPath);
} catch {
  console.log('(Could not create zip automatically - the folder above is ready to use.)');
}
