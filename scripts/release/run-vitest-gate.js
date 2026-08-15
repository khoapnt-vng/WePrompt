#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(filePath) {
  const digest = crypto.createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex');
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-9;]*[mK]/g, '');
}

function validateKnownFlakeRegister(register) {
  if (
    !register ||
    typeof register !== 'object' ||
    register.schemaVersion !== 1 ||
    !Array.isArray(register.signatures)
  ) {
    throw new Error('known-flake register must use schemaVersion 1 and a signatures array');
  }
  const ids = new Set();
  for (const signature of register.signatures) {
    if (!signature || typeof signature !== 'object' || !signature.id || ids.has(signature.id)) {
      throw new Error('known-flake signature ids must be non-empty and unique');
    }
    ids.add(signature.id);
    for (const field of ['issue', 'project', 'file']) {
      if (typeof signature[field] !== 'string' || signature[field] === '') {
        throw new Error(`${signature.id} requires ${field}`);
      }
    }
    if (signature.matchable === true) {
      if (signature.testName !== null && (typeof signature.testName !== 'string' || signature.testName === '')) {
        throw new Error(`${signature.id} requires an exact testName or null teardown marker`);
      }
      if (!Array.isArray(signature.outputPatterns) || signature.outputPatterns.length === 0) {
        throw new Error(`${signature.id} requires outputPatterns`);
      }
      if (!Array.isArray(signature.diagnosticCommand) || signature.diagnosticCommand.length === 0) {
        throw new Error(`${signature.id} requires diagnosticCommand`);
      }
    } else if (signature.matchable === false) {
      if (typeof signature.reason !== 'string' || signature.reason === '') {
        throw new Error(`${signature.id} non-matchable sighting requires a reason`);
      }
    } else {
      throw new Error(`${signature.id} requires explicit matchable boolean`);
    }
  }
  return register;
}

function hasZeroFailedTests(output) {
  return !/Test Files\s+[1-9][0-9]* failed/.test(output) && !/Tests\s+[1-9][0-9]* failed/.test(output);
}

function classifyFailure(failure, failureOutput, register) {
  return (
    register.signatures.find((signature) => {
      if (!signature.matchable) return false;
      if (signature.project !== failure.project || signature.file !== failure.file) return false;
      if (signature.testName !== failure.testName) return false;
      if (!signature.outputPatterns.every((pattern) => failureOutput.includes(pattern))) return false;
      return !signature.requiresZeroFailedTests || hasZeroFailedTests(failureOutput);
    }) ?? null
  );
}

function validateDiagnosticRequest(failure, signature, command, question) {
  if (!failure || failure.classification !== 'known_pending_triage' || failure.signatureId !== signature?.id) {
    throw new Error('diagnostic target is not an exact known pending failure');
  }
  if (typeof question !== 'string' || question.trim() === '') throw new Error('diagnostic requires a stated question');
  if (JSON.stringify(command) !== JSON.stringify(signature.diagnosticCommand)) {
    throw new Error('diagnostic must use the exact registered command');
  }
}

function validateFullSuiteCommand(command) {
  if (JSON.stringify(command) !== JSON.stringify(['bun', 'run', 'test'])) {
    throw new Error('full-suite evidence requires the exact bun run test command');
  }
}

function parseFailures(rawOutput, register) {
  const output = stripAnsi(rawOutput);
  const matches = [...output.matchAll(/^\s*FAIL\s+\|([^|]+)\|\s+(.+?)\s+>\s+(.+)$/gm)];
  const failures = matches.map((match, index) => {
    const nextIndex = matches[index + 1]?.index ?? output.length;
    const block = output.slice(match.index, nextIndex);
    const hierarchy = match[3].trim().split(/\s+>\s+/);
    const observed = {
      project: match[1].trim(),
      file: match[2].trim(),
      testName: hierarchy.at(-1) ?? null,
    };
    const signature = classifyFailure(observed, block, register);
    return {
      ...observed,
      signatureId: signature?.id ?? null,
      classification: signature ? 'known_pending_triage' : 'unknown',
      outputDigest: sha256Bytes(block),
    };
  });

  const teardownSignature = register.signatures.find(
    (signature) =>
      signature.matchable &&
      signature.testName === null &&
      output.includes(signature.file) &&
      signature.outputPatterns.every((pattern) => output.includes(pattern)) &&
      (!signature.requiresZeroFailedTests || hasZeroFailedTests(output))
  );
  if (teardownSignature && !failures.some((failure) => failure.signatureId === teardownSignature.id)) {
    failures.push({
      project: teardownSignature.project,
      file: teardownSignature.file,
      testName: null,
      signatureId: teardownSignature.id,
      classification: 'known_pending_triage',
      outputDigest: sha256Bytes(output),
    });
  }
  return failures;
}

function commandOutput(command, args = []) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`unable to run ${command} ${args.join(' ')}`);
  return result.stdout.trim();
}

function parseArgs(argv) {
  const separator = argv.indexOf('--');
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error('usage: run-vitest-gate.js --register <json> --ledger <json> --log-dir <dir> -- <command...>');
  }
  const options = {};
  for (let index = 0; index < separator; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--register', '--ledger', '--log-dir', '--diagnostic-for', '--question'].includes(key) || !value) {
      throw new Error(`invalid option: ${key}`);
    }
    options[key.slice(2)] = value;
  }
  for (const required of ['register', 'ledger', 'log-dir']) {
    if (!options[required]) throw new Error(`missing --${required}`);
  }
  return { options, command: argv.slice(separator + 1) };
}

function writeLedger(ledgerPath, ledger) {
  const temporaryLedgerPath = `${ledgerPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryLedgerPath, `${JSON.stringify(ledger, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporaryLedgerPath, ledgerPath);
}

function runCommand(command, logPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(logPath, { flags: 'wx' });
    const child = spawn(command[0], command.slice(1), { env: process.env, stdio: ['inherit', 'pipe', 'pipe'] });
    const chunks = [];
    const capture = (stream, target) => {
      stream.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
        output.write(chunk);
        target.write(chunk);
      });
    };
    capture(child.stdout, process.stdout);
    capture(child.stderr, process.stderr);
    child.once('error', (error) => {
      output.end();
      reject(error);
    });
    child.once('close', (code, signal) => {
      output.end(() => resolve({ exitCode: code ?? 1, signal, rawOutput: Buffer.concat(chunks).toString('utf8') }));
    });
  });
}

async function runGate(argv = process.argv.slice(2)) {
  const { options, command } = parseArgs(argv);
  const cwd = process.cwd();
  const registerPath = path.resolve(options.register);
  const ledgerPath = path.resolve(options.ledger);
  const logDirectory = path.resolve(options['log-dir']);
  const registerBytes = fs.readFileSync(registerPath);
  const register = validateKnownFlakeRegister(JSON.parse(registerBytes.toString('utf8')));
  const registerSha256 = sha256Bytes(registerBytes);
  const ledger = fs.existsSync(ledgerPath)
    ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    : { schemaVersion: 1, registerSha256, totalRunCount: 0, attempts: [] };
  if (ledger.registerSha256 !== registerSha256)
    throw new Error('ledger registerSha256 does not match the current register');
  if (!Array.isArray(ledger.attempts)) throw new Error('ledger attempts must be an array');

  if (options['diagnostic-for']) {
    const target = /^(\d+):(\d+)$/.exec(options['diagnostic-for']);
    if (!target) throw new Error('--diagnostic-for must be <attempt-number>:<failure-index>');
    const attemptNumber = Number(target[1]);
    const failureIndex = Number(target[2]);
    const attempt = ledger.attempts[attemptNumber - 1];
    const failure = attempt?.failures?.[failureIndex];
    const signature = register.signatures.find((entry) => entry.id === failure?.signatureId);
    validateDiagnosticRequest(failure, signature, command, options.question);
    if (failure.diagnostic) throw new Error('diagnostic evidence already exists for this failure');

    fs.mkdirSync(logDirectory, { recursive: true });
    const logPath = path.join(logDirectory, `diagnostic-attempt-${attemptNumber}-failure-${failureIndex}.log`);
    const result = await runCommand(command, logPath);
    failure.diagnostic = {
      question: options.question.trim(),
      command,
      exitCode: result.exitCode,
      rawLogSha256: sha256File(logPath),
    };
    writeLedger(ledgerPath, ledger);
    process.stdout.write(
      `\nRecorded diagnostic for attempt ${attemptNumber} failure ${failureIndex}; reviewer disposition still required.\n`
    );
    return result.exitCode;
  }

  validateFullSuiteCommand(command);

  const commit = commandOutput('git', ['rev-parse', 'HEAD']);
  const runner = {
    os: process.platform,
    architecture: process.arch,
    name: process.env.RUNNER_NAME?.trim() || `local-${process.platform}-${process.arch}`,
  };
  const duplicate = ledger.attempts.find(
    (attempt) =>
      attempt.kind === 'full-suite' &&
      attempt.commit === commit &&
      attempt.runner?.os === runner.os &&
      attempt.runner?.architecture === runner.architecture &&
      attempt.runner?.name === runner.name
  );
  if (duplicate) {
    throw new Error(
      `full-suite attempt already exists for ${commit} on ${runner.name}; triage it instead of rerunning`
    );
  }

  fs.mkdirSync(logDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const attemptNumber = ledger.attempts.length + 1;
  const logPath = path.join(logDirectory, `${commit}-${runner.os}-${runner.architecture}-attempt-${attemptNumber}.log`);
  const startedAt = new Date().toISOString();
  const load = os.loadavg();
  const result = await runCommand(command, logPath);
  const endedAt = new Date().toISOString();
  const cleanLogPath = logPath.replace(/\.log$/, '.clean.log');
  fs.writeFileSync(cleanLogPath, stripAnsi(result.rawOutput), { flag: 'wx' });
  let failures = result.exitCode === 0 ? [] : parseFailures(result.rawOutput, register);
  if (result.exitCode !== 0 && failures.length === 0) {
    failures = [
      {
        project: null,
        file: null,
        testName: null,
        signatureId: null,
        classification: 'unknown',
        outputDigest: sha256Bytes(stripAnsi(result.rawOutput)),
      },
    ];
  }
  const attempt = {
    attempt: attemptNumber,
    kind: 'full-suite',
    command,
    commit,
    runner,
    tools: { bun: commandOutput('bun', ['--version']), node: process.version.replace(/^v/, '') },
    startedAt,
    endedAt,
    exitCode: result.exitCode,
    result: result.exitCode === 0 ? 'green' : 'red',
    signal: result.signal,
    load: { oneMinute: load[0], fiveMinute: load[1], fifteenMinute: load[2] },
    rawLog: { path: path.relative(cwd, logPath), sha256: sha256File(logPath) },
    cleanLog: { path: path.relative(cwd, cleanLogPath), sha256: sha256File(cleanLogPath) },
    failures,
  };
  ledger.attempts.push(attempt);
  ledger.totalRunCount = ledger.attempts.length;
  writeLedger(ledgerPath, ledger);
  process.stdout.write(
    `\nRecorded full-suite attempt ${attemptNumber}: ${attempt.result}; raw log sha256=${attempt.rawLog.sha256}\n`
  );
  return result.exitCode;
}

module.exports = {
  classifyFailure,
  parseFailures,
  runGate,
  validateDiagnosticRequest,
  validateFullSuiteCommand,
  validateKnownFlakeRegister,
};

if (require.main === module) {
  runGate()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`Vitest gate failed before execution: ${error.message}\n`);
      process.exitCode = 1;
    });
}
