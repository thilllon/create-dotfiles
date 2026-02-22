import cac from 'cac';
import packageJson from '../package.json';
import { DotfileManager } from './dotfile-manager';

const cli = cac('create-dotfiles');
const manager = new DotfileManager();

cli.command('', 'Backup dotfiles (default)').action(() => {
  manager.backup();
});

cli.command('restore', 'Restore dotfiles from backup to home directory').action(() => {
  manager.restore();
});

cli.help();
cli.version(packageJson.version);
cli.parse();
