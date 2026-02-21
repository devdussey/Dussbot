import path from 'node:path';

const command = require(path.join(process.cwd(), 'src', 'commands', 'autorespond.js'));

export = command;
