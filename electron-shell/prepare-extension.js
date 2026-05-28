const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, '.ext-build');

function copyDir(src, dest, skip) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
        if (skip(name)) {
            continue;
        }
        const from = path.join(src, name);
        const to = path.join(dest, name);
        if (fs.statSync(from).isDirectory()) {
            copyDir(from, to, skip);
        } else {
            fs.copyFileSync(from, to);
        }
    }
}

function prepare() {
    if (fs.existsSync(OUT)) {
        fs.rmSync(OUT, { recursive: true, force: true });
    }

    copyDir(ROOT, OUT, (name) => {
        return (
            name === 'node_modules' ||
            name === 'electron-shell' ||
            name === '.git' ||
            name === '.ext-build'
        );
    });

    fs.copyFileSync(
        path.join(__dirname, 'electron-background-stub.js'),
        path.join(OUT, 'electron-background-stub.js')
    );

    const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
    manifest.permissions = (manifest.permissions || []).filter((p) => p !== 'cookies');
    manifest.background = { service_worker: 'electron-background-stub.js' };
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

    return OUT;
}

module.exports = { prepare, OUT };
