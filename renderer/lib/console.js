/**
 * Console utilities with colored output for Windows
 */

const chalk = require('chalk');

// Force color support on Windows
if (process.platform === 'win32') {
  process.env.FORCE_COLOR = '1';
}

/**
 * Print a banner header
 */
function banner(title) {
  console.log('');
  console.log(chalk.cyan.bold('  ' + '='.repeat(50)));
  console.log(chalk.cyan.bold(`  ${title}`));
  console.log(chalk.cyan.bold('  ' + '='.repeat(50)));
  console.log('');
}

/**
 * Print an info log with label
 */
function log(label, value = '') {
  if (value) {
    console.log(chalk.blue(`  [${label}]`) + chalk.white(` ${value}`));
  } else {
    console.log(chalk.blue(`  ${label}`));
  }
}

/**
 * Print an error message
 */
function error(message) {
  console.log('');
  console.log(chalk.red.bold('  ERROR: ') + chalk.red(message));
  console.log('');
}

/**
 * Print a success message
 */
function success(message) {
  console.log(chalk.green('  + ') + chalk.white(message));
}

/**
 * Print a warning message
 */
function warn(message) {
  console.log(chalk.yellow('  ! ') + chalk.yellow(message));
}

/**
 * Print a progress update (overwrites current line)
 */
function progress(message) {
  process.stdout.write(`\r${chalk.gray('  ' + message)}                    `);
}

/**
 * Clear the current progress line
 */
function clearProgress() {
  process.stdout.write('\r                                                    \r');
}

module.exports = {
  banner,
  log,
  error,
  success,
  warn,
  progress,
  clearProgress,
};
