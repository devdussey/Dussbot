import path from 'node:path';

const command = require(path.join(process.cwd(), 'src', 'commands', 'wordstats.js'));

export = command;
