#!/usr/bin/env node

/**
 * Standalone script to compile contracts with solc and generate TypeChain bindings
 * Uses solc npm package directly instead of Hardhat
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { runTypeChain } from 'typechain';

// Get the parent directory (project root) since script runs from scripts/
const projectRoot = join(__dirname, '..');
const artifactsDir = join(projectRoot, 'artifacts');
const typechainOutDir = join(projectRoot, 'src', 'generated', 'typechain');


function findJsonFiles(dir: string): string[] {
    const files: string[] = [];

    function walkDir(currentDir: string) {
        try {
            const entries = readdirSync(currentDir);

            for (const entry of entries) {
                const fullPath = join(currentDir, entry);
                const stat = statSync(fullPath);

                if (stat.isDirectory()) {
                    // Skip build-info directories
                    if (entry !== 'build-info') {
                        walkDir(fullPath);
                    }
                } else if (stat.isFile() && extname(entry) === '.json' && !entry.endsWith('.dbg.json')) {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            console.warn(`Warning: Could not read directory ${currentDir}: ${error}`);
        }
    }

    walkDir(dir);
    return files;
}

async function generateTypeChain(artifactPaths: string[]): Promise<void> {
    if (!existsSync(typechainOutDir)) {
        mkdirSync(typechainOutDir, { recursive: true });
    }
    
    await runTypeChain({
        cwd: projectRoot,
        filesToProcess: artifactPaths,
        allFiles: artifactPaths,
        outDir: typechainOutDir,
        target: 'ethers-v6'
    });
}

async function main() {
    try {
        console.log('Finding ABI files...');
        const files = findJsonFiles(artifactsDir);

        console.log(`Found ${files.length} ABI files`);
        if (files.length === 0) {
            throw new Error('No ABI files found. Make sure contracts are compiled first.');
        }

        console.log('Generating TypeChain bindings...');  
        await generateTypeChain(files);
        
        console.log('TypeChain generation completed successfully!');
    } catch (error) {
        console.error('Failed to generate TypeChain bindings:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
