const os = require('os');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const archiver = require('archiver');
const glob = require('fast-glob');
const toml = require('@iarna/toml');

import * as core from '@actions/core';

/**
 * Find all crate names for this one project.
 *
 * As it might be either simple or workspace-based crate,
 * we need to gather all names, as we will need them later
 * to find coverage files.
 */
async function getCrateNames(root: string): Promise<string[]> {
    // Probably it is a bad solution and instead we should
    // find all `Cargo.toml` files instead,
    // but so far it should work okay.
    //
    // Also, this routine expects that `Cargo.lock` exists already,
    // which should be, because `cargo test` command will be invoked before that
    const lockContents = await fsPromises.readFile(path.join(root, 'Cargo.lock'));
    const lock = toml.parse(lockContents);

    let crates: string[] = [];
    for (const pkg of (lock['package'] || [])) {
        if (!pkg.source) {
            crates.push(pkg.name);
        }
    }

    return crates;
}

async function getCoverageFiles(root: string): Promise<string[]> {
    const crates = await getCrateNames(root);
    core.info(`Found project crates: ${crates}`);

    let patterns: string[] = [];
    patterns.push(`**/*.profraw`);
    core.info(`Searching for coverage files with patterns: ${patterns}`);
    return glob.sync(patterns, {
        cwd: path.join(root),
        absolute: true,
        onlyFiles: true,
    });
}

export async function prepareArchive(root: string): Promise<string> {
    const coverageFiles: string[] = await getCoverageFiles(root);
    if (coverageFiles.length == 0) {
        throw new Error('Unable to find any coverage files, was `cargo test` executed correctly?');
    }

	return new Promise((resolve, reject) => {
	    const postfix = Math.random().toString(36).substring(2, 15)
	    const resultPath = path.join(os.tmpdir(), `coverage-${postfix}.zip`);
	    core.debug(`Creating an archive with coverage files at ${resultPath}`);
        let output = fs.createWriteStream(resultPath, {
            encoding: 'binary',
        });
        let archive = archiver('zip');

		archive.pipe(output);

        for (const coverageFile of coverageFiles) {
            core.info(`Archiving coverage file: ${coverageFile}`);
            archive.file(coverageFile, {
                name: path.basename(coverageFile),
            });
        }

		archive.finalize();

		output.on('close', function() {
		    core.info(`Coverage files archive was created at the ${resultPath}`);
		    resolve(resultPath);
		});
		archive.on('warning', reject);
		archive.on('error', reject);
	});
}
