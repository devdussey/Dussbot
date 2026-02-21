import path from 'node:path';

const command = require(path.join(process.cwd(), 'src', 'commands', 'analysis.js'));

export = command;
