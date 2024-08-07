#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
const program = new Command();
program.name('@rubynetwork/rammerhead');
program.description('Easily start a standalone Rammerhead server');
program.option('-ho --host', 'Host to listen on', '0.0.0.0');
program.option('-p, --port', 'Port to listen on', '8080');
program.parse(process.argv);
