/**
 * Interactive prompt utilities for the setup wizard.
 * Uses Node.js readline — no external dependencies.
 */

import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import process from 'node:process';

/** Ask a question, return trimmed answer. Optional default shown in [brackets]. */
export async function ask(question: string, defaultVal?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

/**
 * Ask for a secret — input is masked with • characters.
 * Falls back to plain readline if the terminal doesn't support raw mode.
 */
export async function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write(`${question}: `);

    // Try raw mode for masking
    if (typeof stdin.setRawMode === 'function') {
      const chars: string[] = [];

      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf-8');

      const onData = (chunk: string) => {
        for (const char of chunk) {
          const code = char.charCodeAt(0);

          if (code === 13 || code === 10) {
            // Enter — done
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener('data', onData);
            stdout.write('\n');
            resolve(chars.join(''));
            return;
          } else if (code === 3) {
            // Ctrl+C — abort
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener('data', onData);
            stdout.write('\n');
            process.exit(0);
          } else if (code === 127 || code === 8) {
            // Backspace
            if (chars.length > 0) {
              chars.pop();
              stdout.write('\b \b');
            }
          } else if (code >= 32) {
            chars.push(char);
            stdout.write('•');
          }
        }
      };

      stdin.on('data', onData);
    } else {
      // No raw mode (e.g. piped input in tests) — plain readline
      const rl = createInterface({ input: stdin, output: stdout, terminal: false });
      rl.question('', (answer) => {
        rl.close();
        stdout.write('\n');
        resolve(answer.trim());
      });
    }
  });
}

/** Ask yes/no. Returns true for y/yes, false for n/no. Loops until valid. */
export async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  while (true) {
    const answer = (await ask(`${question} (${hint})`)).toLowerCase();
    if (answer === '' ) return defaultYes;
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    console.log('  Please enter y or n.');
  }
}

/**
 * Present a numbered list of choices. Returns the zero-based index chosen.
 * Loops until the user picks a valid number.
 */
export async function askChoice(question: string, choices: string[]): Promise<number> {
  console.log(`\n${question}`);
  choices.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));

  while (true) {
    const answer = await ask('Enter number');
    const n = parseInt(answer, 10);
    if (n >= 1 && n <= choices.length) return n - 1;
    console.log(`  Please enter a number between 1 and ${choices.length}.`);
  }
}
