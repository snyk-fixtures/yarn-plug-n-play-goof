#!/usr/bin/env node

/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, null, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const ignorePattern = null ? new RegExp(null) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = [];
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}\//;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![a-zA-Z]:[\\\/]|\\\\|\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `)
    );
  }

  return locator;
}

let packageInformationStores = new Map([
  ["create-react-app", new Map([
    ["3.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-create-react-app-3.1.2-0a417141ef94bda6756ff773f9744329b5da7d9d/node_modules/create-react-app/"),
      packageDependencies: new Map([
        ["chalk", "2.4.2"],
        ["commander", "2.20.0"],
        ["cross-spawn", "6.0.5"],
        ["envinfo", "7.3.1"],
        ["fs-extra", "7.0.1"],
        ["hyperquest", "2.1.3"],
        ["inquirer", "6.5.0"],
        ["semver", "6.3.0"],
        ["tar-pack", "3.4.1"],
        ["tmp", "0.0.33"],
        ["validate-npm-package-name", "3.0.0"],
        ["create-react-app", "3.1.2"],
      ]),
    }],
  ])],
  ["chalk", new Map([
    ["2.4.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-chalk-2.4.2-cd42541677a54333cf541a49108c1432b44c9424/node_modules/chalk/"),
      packageDependencies: new Map([
        ["ansi-styles", "3.2.1"],
        ["escape-string-regexp", "1.0.5"],
        ["supports-color", "5.5.0"],
        ["chalk", "2.4.2"],
      ]),
    }],
  ])],
  ["ansi-styles", new Map([
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ansi-styles-3.2.1-41fbb20243e50b12be0f04b8dedbf07520ce841d/node_modules/ansi-styles/"),
      packageDependencies: new Map([
        ["color-convert", "1.9.3"],
        ["ansi-styles", "3.2.1"],
      ]),
    }],
  ])],
  ["color-convert", new Map([
    ["1.9.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-color-convert-1.9.3-bb71850690e1f136567de629d2d5471deda4c1e8/node_modules/color-convert/"),
      packageDependencies: new Map([
        ["color-name", "1.1.3"],
        ["color-convert", "1.9.3"],
      ]),
    }],
  ])],
  ["color-name", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-color-name-1.1.3-a7d0558bd89c42f795dd42328f740831ca53bc25/node_modules/color-name/"),
      packageDependencies: new Map([
        ["color-name", "1.1.3"],
      ]),
    }],
  ])],
  ["escape-string-regexp", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4/node_modules/escape-string-regexp/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
      ]),
    }],
  ])],
  ["supports-color", new Map([
    ["5.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-supports-color-5.5.0-e2e69a44ac8772f78a1ec0b35b689df6530efc8f/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
        ["supports-color", "5.5.0"],
      ]),
    }],
  ])],
  ["has-flag", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-flag-3.0.0-b5d454dc2199ae225699f3467e5a07f3b955bafd/node_modules/has-flag/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
      ]),
    }],
  ])],
  ["commander", new Map([
    ["2.20.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-commander-2.20.0-d58bb2b5c1ee8f87b0d340027e9e94e222c5a422/node_modules/commander/"),
      packageDependencies: new Map([
        ["commander", "2.20.0"],
      ]),
    }],
  ])],
  ["cross-spawn", new Map([
    ["6.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cross-spawn-6.0.5-4a5ec7c64dfae22c3a14124dbacdee846d80cbc4/node_modules/cross-spawn/"),
      packageDependencies: new Map([
        ["nice-try", "1.0.5"],
        ["path-key", "2.0.1"],
        ["semver", "5.7.1"],
        ["shebang-command", "1.2.0"],
        ["which", "1.3.1"],
        ["cross-spawn", "6.0.5"],
      ]),
    }],
  ])],
  ["nice-try", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-nice-try-1.0.5-a3378a7696ce7d223e88fc9b764bd7ef1089e366/node_modules/nice-try/"),
      packageDependencies: new Map([
        ["nice-try", "1.0.5"],
      ]),
    }],
  ])],
  ["path-key", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-key-2.0.1-411cadb574c5a140d3a4b1910d40d80cc9f40b40/node_modules/path-key/"),
      packageDependencies: new Map([
        ["path-key", "2.0.1"],
      ]),
    }],
  ])],
  ["semver", new Map([
    ["5.7.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "5.7.1"],
      ]),
    }],
    ["6.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-semver-6.3.0-ee0a64c8af5e8ceea67687b133761e1becbd1d3d/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "6.3.0"],
      ]),
    }],
  ])],
  ["shebang-command", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-shebang-command-1.2.0-44aac65b695b03398968c39f363fee5deafdf1ea/node_modules/shebang-command/"),
      packageDependencies: new Map([
        ["shebang-regex", "1.0.0"],
        ["shebang-command", "1.2.0"],
      ]),
    }],
  ])],
  ["shebang-regex", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-shebang-regex-1.0.0-da42f49740c0b42db2ca9728571cb190c98efea3/node_modules/shebang-regex/"),
      packageDependencies: new Map([
        ["shebang-regex", "1.0.0"],
      ]),
    }],
  ])],
  ["which", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a/node_modules/which/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
        ["which", "1.3.1"],
      ]),
    }],
  ])],
  ["isexe", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10/node_modules/isexe/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
      ]),
    }],
  ])],
  ["envinfo", new Map([
    ["7.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-envinfo-7.3.1-892e42f7bf858b3446d9414ad240dbaf8da52f09/node_modules/envinfo/"),
      packageDependencies: new Map([
        ["envinfo", "7.3.1"],
      ]),
    }],
  ])],
  ["fs-extra", new Map([
    ["7.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fs-extra-7.0.1-4f189c44aa123b895f722804f55ea23eadc348e9/node_modules/fs-extra/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["jsonfile", "4.0.0"],
        ["universalify", "0.1.2"],
        ["fs-extra", "7.0.1"],
      ]),
    }],
  ])],
  ["graceful-fs", new Map([
    ["4.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-graceful-fs-4.2.2-6f0952605d0140c1cfdb138ed005775b92d67b02/node_modules/graceful-fs/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
      ]),
    }],
  ])],
  ["jsonfile", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-jsonfile-4.0.0-8771aae0799b64076b76640fca058f9c10e33ecb/node_modules/jsonfile/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["jsonfile", "4.0.0"],
      ]),
    }],
  ])],
  ["universalify", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-universalify-0.1.2-b646f69be3942dabcecc9d6639c80dc105efaa66/node_modules/universalify/"),
      packageDependencies: new Map([
        ["universalify", "0.1.2"],
      ]),
    }],
  ])],
  ["hyperquest", new Map([
    ["2.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-hyperquest-2.1.3-523127d7a343181b40bf324e231d2576edf52633/node_modules/hyperquest/"),
      packageDependencies: new Map([
        ["buffer-from", "0.1.2"],
        ["duplexer2", "0.0.2"],
        ["through2", "0.6.5"],
        ["hyperquest", "2.1.3"],
      ]),
    }],
  ])],
  ["buffer-from", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-buffer-from-0.1.2-15f4b9bcef012044df31142c14333caf6e0260d0/node_modules/buffer-from/"),
      packageDependencies: new Map([
        ["buffer-from", "0.1.2"],
      ]),
    }],
  ])],
  ["duplexer2", new Map([
    ["0.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-duplexer2-0.0.2-c614dcf67e2fb14995a91711e5a617e8a60a31db/node_modules/duplexer2/"),
      packageDependencies: new Map([
        ["readable-stream", "1.1.14"],
        ["duplexer2", "0.0.2"],
      ]),
    }],
  ])],
  ["readable-stream", new Map([
    ["1.1.14", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-readable-stream-1.1.14-7cf4c54ef648e3813084c636dd2079e166c081d9/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
        ["inherits", "2.0.4"],
        ["isarray", "0.0.1"],
        ["string_decoder", "0.10.31"],
        ["readable-stream", "1.1.14"],
      ]),
    }],
    ["1.0.34", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-readable-stream-1.0.34-125820e34bc842d2f2aaafafe4c2916ee32c157c/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
        ["inherits", "2.0.4"],
        ["isarray", "0.0.1"],
        ["string_decoder", "0.10.31"],
        ["readable-stream", "1.0.34"],
      ]),
    }],
    ["2.3.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-readable-stream-2.3.6-b11c27d88b8ff1fbe070643cf94b0c79ae1b0aaf/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
        ["inherits", "2.0.4"],
        ["isarray", "1.0.0"],
        ["process-nextick-args", "2.0.1"],
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
        ["util-deprecate", "1.0.2"],
        ["readable-stream", "2.3.6"],
      ]),
    }],
  ])],
  ["core-util-is", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-core-util-is-1.0.2-b5fd54220aa2bc5ab57aab7140c940754503c1a7/node_modules/core-util-is/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
      ]),
    }],
  ])],
  ["inherits", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
      ]),
    }],
  ])],
  ["isarray", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-isarray-0.0.1-8a18acfca9a8f4177e09abfc6038939b05d1eedf/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "0.0.1"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
      ]),
    }],
  ])],
  ["string_decoder", new Map([
    ["0.10.31", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-string-decoder-0.10.31-62e203bc41766c6c28c9fc84301dab1c5310fa94/node_modules/string_decoder/"),
      packageDependencies: new Map([
        ["string_decoder", "0.10.31"],
      ]),
    }],
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8/node_modules/string_decoder/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
      ]),
    }],
  ])],
  ["through2", new Map([
    ["0.6.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-through2-0.6.5-41ab9c67b29d57209071410e1d7a7a968cd3ad48/node_modules/through2/"),
      packageDependencies: new Map([
        ["readable-stream", "1.0.34"],
        ["xtend", "4.0.2"],
        ["through2", "0.6.5"],
      ]),
    }],
  ])],
  ["xtend", new Map([
    ["4.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-xtend-4.0.2-bb72779f5fa465186b1f438f674fa347fdb5db54/node_modules/xtend/"),
      packageDependencies: new Map([
        ["xtend", "4.0.2"],
      ]),
    }],
  ])],
  ["inquirer", new Map([
    ["6.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inquirer-6.5.0-2303317efc9a4ea7ec2e2df6f86569b734accf42/node_modules/inquirer/"),
      packageDependencies: new Map([
        ["ansi-escapes", "3.2.0"],
        ["chalk", "2.4.2"],
        ["cli-cursor", "2.1.0"],
        ["cli-width", "2.2.0"],
        ["external-editor", "3.1.0"],
        ["figures", "2.0.0"],
        ["lodash", "4.17.15"],
        ["mute-stream", "0.0.7"],
        ["run-async", "2.3.0"],
        ["rxjs", "6.5.3"],
        ["string-width", "2.1.1"],
        ["strip-ansi", "5.2.0"],
        ["through", "2.3.8"],
        ["inquirer", "6.5.0"],
      ]),
    }],
  ])],
  ["ansi-escapes", new Map([
    ["3.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ansi-escapes-3.2.0-8780b98ff9dbf5638152d1f1fe5c1d7b4442976b/node_modules/ansi-escapes/"),
      packageDependencies: new Map([
        ["ansi-escapes", "3.2.0"],
      ]),
    }],
  ])],
  ["cli-cursor", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cli-cursor-2.1.0-b35dac376479facc3e94747d41d0d0f5238ffcb5/node_modules/cli-cursor/"),
      packageDependencies: new Map([
        ["restore-cursor", "2.0.0"],
        ["cli-cursor", "2.1.0"],
      ]),
    }],
  ])],
  ["restore-cursor", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-restore-cursor-2.0.0-9f7ee287f82fd326d4fd162923d62129eee0dfaf/node_modules/restore-cursor/"),
      packageDependencies: new Map([
        ["onetime", "2.0.1"],
        ["signal-exit", "3.0.2"],
        ["restore-cursor", "2.0.0"],
      ]),
    }],
  ])],
  ["onetime", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-onetime-2.0.1-067428230fd67443b2794b22bba528b6867962d4/node_modules/onetime/"),
      packageDependencies: new Map([
        ["mimic-fn", "1.2.0"],
        ["onetime", "2.0.1"],
      ]),
    }],
  ])],
  ["mimic-fn", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mimic-fn-1.2.0-820c86a39334640e99516928bd03fca88057d022/node_modules/mimic-fn/"),
      packageDependencies: new Map([
        ["mimic-fn", "1.2.0"],
      ]),
    }],
  ])],
  ["signal-exit", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-signal-exit-3.0.2-b5fdc08f1287ea1178628e415e25132b73646c6d/node_modules/signal-exit/"),
      packageDependencies: new Map([
        ["signal-exit", "3.0.2"],
      ]),
    }],
  ])],
  ["cli-width", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cli-width-2.2.0-ff19ede8a9a5e579324147b0c11f0fbcbabed639/node_modules/cli-width/"),
      packageDependencies: new Map([
        ["cli-width", "2.2.0"],
      ]),
    }],
  ])],
  ["external-editor", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-external-editor-3.1.0-cb03f740befae03ea4d283caed2741a83f335495/node_modules/external-editor/"),
      packageDependencies: new Map([
        ["chardet", "0.7.0"],
        ["iconv-lite", "0.4.24"],
        ["tmp", "0.0.33"],
        ["external-editor", "3.1.0"],
      ]),
    }],
  ])],
  ["chardet", new Map([
    ["0.7.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-chardet-0.7.0-90094849f0937f2eedc2425d0d28a9e5f0cbad9e/node_modules/chardet/"),
      packageDependencies: new Map([
        ["chardet", "0.7.0"],
      ]),
    }],
  ])],
  ["iconv-lite", new Map([
    ["0.4.24", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b/node_modules/iconv-lite/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
        ["iconv-lite", "0.4.24"],
      ]),
    }],
  ])],
  ["safer-buffer", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a/node_modules/safer-buffer/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
      ]),
    }],
  ])],
  ["tmp", new Map([
    ["0.0.33", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tmp-0.0.33-6d34335889768d21b2bcda0aa277ced3b1bfadf9/node_modules/tmp/"),
      packageDependencies: new Map([
        ["os-tmpdir", "1.0.2"],
        ["tmp", "0.0.33"],
      ]),
    }],
  ])],
  ["os-tmpdir", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-os-tmpdir-1.0.2-bbe67406c79aa85c5cfec766fe5734555dfa1274/node_modules/os-tmpdir/"),
      packageDependencies: new Map([
        ["os-tmpdir", "1.0.2"],
      ]),
    }],
  ])],
  ["figures", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-figures-2.0.0-3ab1a2d2a62c8bfb431a0c94cb797a2fce27c962/node_modules/figures/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
        ["figures", "2.0.0"],
      ]),
    }],
  ])],
  ["lodash", new Map([
    ["4.17.15", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-4.17.15-b447f6670a0455bbfeedd11392eff330ea097548/node_modules/lodash/"),
      packageDependencies: new Map([
        ["lodash", "4.17.15"],
      ]),
    }],
  ])],
  ["mute-stream", new Map([
    ["0.0.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mute-stream-0.0.7-3075ce93bc21b8fab43e1bc4da7e8115ed1e7bab/node_modules/mute-stream/"),
      packageDependencies: new Map([
        ["mute-stream", "0.0.7"],
      ]),
    }],
  ])],
  ["run-async", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-run-async-2.3.0-0371ab4ae0bdd720d4166d7dfda64ff7a445a6c0/node_modules/run-async/"),
      packageDependencies: new Map([
        ["is-promise", "2.1.0"],
        ["run-async", "2.3.0"],
      ]),
    }],
  ])],
  ["is-promise", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-promise-2.1.0-79a2a9ece7f096e80f36d2b2f3bc16c1ff4bf3fa/node_modules/is-promise/"),
      packageDependencies: new Map([
        ["is-promise", "2.1.0"],
      ]),
    }],
  ])],
  ["rxjs", new Map([
    ["6.5.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-rxjs-6.5.3-510e26317f4db91a7eb1de77d9dd9ba0a4899a3a/node_modules/rxjs/"),
      packageDependencies: new Map([
        ["tslib", "1.10.0"],
        ["rxjs", "6.5.3"],
      ]),
    }],
  ])],
  ["tslib", new Map([
    ["1.10.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tslib-1.10.0-c3c19f95973fb0a62973fb09d90d961ee43e5c8a/node_modules/tslib/"),
      packageDependencies: new Map([
        ["tslib", "1.10.0"],
      ]),
    }],
  ])],
  ["string-width", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-string-width-2.1.1-ab93f27a8dc13d28cac815c462143a6d9012ae9e/node_modules/string-width/"),
      packageDependencies: new Map([
        ["is-fullwidth-code-point", "2.0.0"],
        ["strip-ansi", "4.0.0"],
        ["string-width", "2.1.1"],
      ]),
    }],
  ])],
  ["is-fullwidth-code-point", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-fullwidth-code-point-2.0.0-a3b30a5c4f199183167aaab93beefae3ddfb654f/node_modules/is-fullwidth-code-point/"),
      packageDependencies: new Map([
        ["is-fullwidth-code-point", "2.0.0"],
      ]),
    }],
  ])],
  ["strip-ansi", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-strip-ansi-4.0.0-a8479022eb1ac368a871389b635262c505ee368f/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "3.0.0"],
        ["strip-ansi", "4.0.0"],
      ]),
    }],
    ["5.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-strip-ansi-5.2.0-8c9a536feb6afc962bdfa5b104a5091c1ad9c0ae/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "4.1.0"],
        ["strip-ansi", "5.2.0"],
      ]),
    }],
  ])],
  ["ansi-regex", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ansi-regex-3.0.0-ed0317c322064f79466c02966bddb605ab37d998/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "3.0.0"],
      ]),
    }],
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ansi-regex-4.1.0-8b9f8f08cf1acb843756a839ca8c7e3168c51997/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "4.1.0"],
      ]),
    }],
  ])],
  ["through", new Map([
    ["2.3.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-through-2.3.8-0dd4c9ffaabc357960b1b724115d7e0e86a2e1f5/node_modules/through/"),
      packageDependencies: new Map([
        ["through", "2.3.8"],
      ]),
    }],
  ])],
  ["tar-pack", new Map([
    ["3.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tar-pack-3.4.1-e1dbc03a9b9d3ba07e896ad027317eb679a10a1f/node_modules/tar-pack/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["fstream", "1.0.12"],
        ["fstream-ignore", "1.0.5"],
        ["once", "1.4.0"],
        ["readable-stream", "2.3.6"],
        ["rimraf", "2.7.1"],
        ["tar", "2.2.2"],
        ["uid-number", "0.0.6"],
        ["tar-pack", "3.4.1"],
      ]),
    }],
  ])],
  ["debug", new Map([
    ["2.6.9", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "2.6.9"],
      ]),
    }],
  ])],
  ["ms", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
      ]),
    }],
  ])],
  ["fstream", new Map([
    ["1.0.12", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fstream-1.0.12-4e8ba8ee2d48be4f7d0de505455548eae5932045/node_modules/fstream/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["inherits", "2.0.4"],
        ["mkdirp", "0.5.1"],
        ["rimraf", "2.7.1"],
        ["fstream", "1.0.12"],
      ]),
    }],
  ])],
  ["mkdirp", new Map([
    ["0.5.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mkdirp-0.5.1-30057438eac6cf7f8c4767f38648d6697d75c903/node_modules/mkdirp/"),
      packageDependencies: new Map([
        ["minimist", "0.0.8"],
        ["mkdirp", "0.5.1"],
      ]),
    }],
  ])],
  ["minimist", new Map([
    ["0.0.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-minimist-0.0.8-857fcabfc3397d2625b8228262e86aa7a011b05d/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "0.0.8"],
      ]),
    }],
  ])],
  ["rimraf", new Map([
    ["2.7.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-rimraf-2.7.1-35797f13a7fdadc566142c29d4f07ccad483e3ec/node_modules/rimraf/"),
      packageDependencies: new Map([
        ["glob", "7.1.4"],
        ["rimraf", "2.7.1"],
      ]),
    }],
  ])],
  ["glob", new Map([
    ["7.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-glob-7.1.4-aa608a2f6c577ad357e1ae5a5c26d9a8d1969255/node_modules/glob/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
        ["inflight", "1.0.6"],
        ["inherits", "2.0.4"],
        ["minimatch", "3.0.4"],
        ["once", "1.4.0"],
        ["path-is-absolute", "1.0.1"],
        ["glob", "7.1.4"],
      ]),
    }],
  ])],
  ["fs.realpath", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f/node_modules/fs.realpath/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
      ]),
    }],
  ])],
  ["inflight", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9/node_modules/inflight/"),
      packageDependencies: new Map([
        ["once", "1.4.0"],
        ["wrappy", "1.0.2"],
        ["inflight", "1.0.6"],
      ]),
    }],
  ])],
  ["once", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1/node_modules/once/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
        ["once", "1.4.0"],
      ]),
    }],
  ])],
  ["wrappy", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f/node_modules/wrappy/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
      ]),
    }],
  ])],
  ["minimatch", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083/node_modules/minimatch/"),
      packageDependencies: new Map([
        ["brace-expansion", "1.1.11"],
        ["minimatch", "3.0.4"],
      ]),
    }],
  ])],
  ["brace-expansion", new Map([
    ["1.1.11", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd/node_modules/brace-expansion/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
        ["concat-map", "0.0.1"],
        ["brace-expansion", "1.1.11"],
      ]),
    }],
  ])],
  ["balanced-match", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767/node_modules/balanced-match/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
      ]),
    }],
  ])],
  ["concat-map", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b/node_modules/concat-map/"),
      packageDependencies: new Map([
        ["concat-map", "0.0.1"],
      ]),
    }],
  ])],
  ["path-is-absolute", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/"),
      packageDependencies: new Map([
        ["path-is-absolute", "1.0.1"],
      ]),
    }],
  ])],
  ["fstream-ignore", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fstream-ignore-1.0.5-9c31dae34767018fe1d249b24dada67d092da105/node_modules/fstream-ignore/"),
      packageDependencies: new Map([
        ["fstream", "1.0.12"],
        ["inherits", "2.0.4"],
        ["minimatch", "3.0.4"],
        ["fstream-ignore", "1.0.5"],
      ]),
    }],
  ])],
  ["process-nextick-args", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-process-nextick-args-2.0.1-7820d9b16120cc55ca9ae7792680ae7dba6d7fe2/node_modules/process-nextick-args/"),
      packageDependencies: new Map([
        ["process-nextick-args", "2.0.1"],
      ]),
    }],
  ])],
  ["safe-buffer", new Map([
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
      ]),
    }],
  ])],
  ["util-deprecate", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf/node_modules/util-deprecate/"),
      packageDependencies: new Map([
        ["util-deprecate", "1.0.2"],
      ]),
    }],
  ])],
  ["tar", new Map([
    ["2.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tar-2.2.2-0ca8848562c7299b8b446ff6a4d60cdbb23edc40/node_modules/tar/"),
      packageDependencies: new Map([
        ["block-stream", "0.0.9"],
        ["fstream", "1.0.12"],
        ["inherits", "2.0.4"],
        ["tar", "2.2.2"],
      ]),
    }],
  ])],
  ["block-stream", new Map([
    ["0.0.9", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-block-stream-0.0.9-13ebfe778a03205cfe03751481ebb4b3300c126a/node_modules/block-stream/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
        ["block-stream", "0.0.9"],
      ]),
    }],
  ])],
  ["uid-number", new Map([
    ["0.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-uid-number-0.0.6-0ea10e8035e8eb5b8e4449f06da1c730663baa81/node_modules/uid-number/"),
      packageDependencies: new Map([
        ["uid-number", "0.0.6"],
      ]),
    }],
  ])],
  ["validate-npm-package-name", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-validate-npm-package-name-3.0.0-5fa912d81eb7d0c74afc140de7317f0ca7df437e/node_modules/validate-npm-package-name/"),
      packageDependencies: new Map([
        ["builtins", "1.0.3"],
        ["validate-npm-package-name", "3.0.0"],
      ]),
    }],
  ])],
  ["builtins", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-builtins-1.0.3-cb94faeb61c8696451db36534e1422f94f0aee88/node_modules/builtins/"),
      packageDependencies: new Map([
        ["builtins", "1.0.3"],
      ]),
    }],
  ])],
  [null, new Map([
    [null, {
      packageLocation: path.resolve(__dirname, "./"),
      packageDependencies: new Map([
        ["create-react-app", "3.1.2"],
        ["lodash", "4.17.15"],
      ]),
    }],
  ])],
]);

let locatorsByLocations = new Map([
  ["../../Library/Caches/Yarn/v4/npm-create-react-app-3.1.2-0a417141ef94bda6756ff773f9744329b5da7d9d/node_modules/create-react-app/", {"name":"create-react-app","reference":"3.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-chalk-2.4.2-cd42541677a54333cf541a49108c1432b44c9424/node_modules/chalk/", {"name":"chalk","reference":"2.4.2"}],
  ["../../Library/Caches/Yarn/v4/npm-ansi-styles-3.2.1-41fbb20243e50b12be0f04b8dedbf07520ce841d/node_modules/ansi-styles/", {"name":"ansi-styles","reference":"3.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-color-convert-1.9.3-bb71850690e1f136567de629d2d5471deda4c1e8/node_modules/color-convert/", {"name":"color-convert","reference":"1.9.3"}],
  ["../../Library/Caches/Yarn/v4/npm-color-name-1.1.3-a7d0558bd89c42f795dd42328f740831ca53bc25/node_modules/color-name/", {"name":"color-name","reference":"1.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4/node_modules/escape-string-regexp/", {"name":"escape-string-regexp","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-supports-color-5.5.0-e2e69a44ac8772f78a1ec0b35b689df6530efc8f/node_modules/supports-color/", {"name":"supports-color","reference":"5.5.0"}],
  ["../../Library/Caches/Yarn/v4/npm-has-flag-3.0.0-b5d454dc2199ae225699f3467e5a07f3b955bafd/node_modules/has-flag/", {"name":"has-flag","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-commander-2.20.0-d58bb2b5c1ee8f87b0d340027e9e94e222c5a422/node_modules/commander/", {"name":"commander","reference":"2.20.0"}],
  ["../../Library/Caches/Yarn/v4/npm-cross-spawn-6.0.5-4a5ec7c64dfae22c3a14124dbacdee846d80cbc4/node_modules/cross-spawn/", {"name":"cross-spawn","reference":"6.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-nice-try-1.0.5-a3378a7696ce7d223e88fc9b764bd7ef1089e366/node_modules/nice-try/", {"name":"nice-try","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-path-key-2.0.1-411cadb574c5a140d3a4b1910d40d80cc9f40b40/node_modules/path-key/", {"name":"path-key","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7/node_modules/semver/", {"name":"semver","reference":"5.7.1"}],
  ["../../Library/Caches/Yarn/v4/npm-semver-6.3.0-ee0a64c8af5e8ceea67687b133761e1becbd1d3d/node_modules/semver/", {"name":"semver","reference":"6.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-shebang-command-1.2.0-44aac65b695b03398968c39f363fee5deafdf1ea/node_modules/shebang-command/", {"name":"shebang-command","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-shebang-regex-1.0.0-da42f49740c0b42db2ca9728571cb190c98efea3/node_modules/shebang-regex/", {"name":"shebang-regex","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a/node_modules/which/", {"name":"which","reference":"1.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10/node_modules/isexe/", {"name":"isexe","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-envinfo-7.3.1-892e42f7bf858b3446d9414ad240dbaf8da52f09/node_modules/envinfo/", {"name":"envinfo","reference":"7.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-fs-extra-7.0.1-4f189c44aa123b895f722804f55ea23eadc348e9/node_modules/fs-extra/", {"name":"fs-extra","reference":"7.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-graceful-fs-4.2.2-6f0952605d0140c1cfdb138ed005775b92d67b02/node_modules/graceful-fs/", {"name":"graceful-fs","reference":"4.2.2"}],
  ["../../Library/Caches/Yarn/v4/npm-jsonfile-4.0.0-8771aae0799b64076b76640fca058f9c10e33ecb/node_modules/jsonfile/", {"name":"jsonfile","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-universalify-0.1.2-b646f69be3942dabcecc9d6639c80dc105efaa66/node_modules/universalify/", {"name":"universalify","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-hyperquest-2.1.3-523127d7a343181b40bf324e231d2576edf52633/node_modules/hyperquest/", {"name":"hyperquest","reference":"2.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-buffer-from-0.1.2-15f4b9bcef012044df31142c14333caf6e0260d0/node_modules/buffer-from/", {"name":"buffer-from","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-duplexer2-0.0.2-c614dcf67e2fb14995a91711e5a617e8a60a31db/node_modules/duplexer2/", {"name":"duplexer2","reference":"0.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-readable-stream-1.1.14-7cf4c54ef648e3813084c636dd2079e166c081d9/node_modules/readable-stream/", {"name":"readable-stream","reference":"1.1.14"}],
  ["../../Library/Caches/Yarn/v4/npm-readable-stream-1.0.34-125820e34bc842d2f2aaafafe4c2916ee32c157c/node_modules/readable-stream/", {"name":"readable-stream","reference":"1.0.34"}],
  ["../../Library/Caches/Yarn/v4/npm-readable-stream-2.3.6-b11c27d88b8ff1fbe070643cf94b0c79ae1b0aaf/node_modules/readable-stream/", {"name":"readable-stream","reference":"2.3.6"}],
  ["../../Library/Caches/Yarn/v4/npm-core-util-is-1.0.2-b5fd54220aa2bc5ab57aab7140c940754503c1a7/node_modules/core-util-is/", {"name":"core-util-is","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c/node_modules/inherits/", {"name":"inherits","reference":"2.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-isarray-0.0.1-8a18acfca9a8f4177e09abfc6038939b05d1eedf/node_modules/isarray/", {"name":"isarray","reference":"0.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11/node_modules/isarray/", {"name":"isarray","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-string-decoder-0.10.31-62e203bc41766c6c28c9fc84301dab1c5310fa94/node_modules/string_decoder/", {"name":"string_decoder","reference":"0.10.31"}],
  ["../../Library/Caches/Yarn/v4/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8/node_modules/string_decoder/", {"name":"string_decoder","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-through2-0.6.5-41ab9c67b29d57209071410e1d7a7a968cd3ad48/node_modules/through2/", {"name":"through2","reference":"0.6.5"}],
  ["../../Library/Caches/Yarn/v4/npm-xtend-4.0.2-bb72779f5fa465186b1f438f674fa347fdb5db54/node_modules/xtend/", {"name":"xtend","reference":"4.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-inquirer-6.5.0-2303317efc9a4ea7ec2e2df6f86569b734accf42/node_modules/inquirer/", {"name":"inquirer","reference":"6.5.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ansi-escapes-3.2.0-8780b98ff9dbf5638152d1f1fe5c1d7b4442976b/node_modules/ansi-escapes/", {"name":"ansi-escapes","reference":"3.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-cli-cursor-2.1.0-b35dac376479facc3e94747d41d0d0f5238ffcb5/node_modules/cli-cursor/", {"name":"cli-cursor","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-restore-cursor-2.0.0-9f7ee287f82fd326d4fd162923d62129eee0dfaf/node_modules/restore-cursor/", {"name":"restore-cursor","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-onetime-2.0.1-067428230fd67443b2794b22bba528b6867962d4/node_modules/onetime/", {"name":"onetime","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-mimic-fn-1.2.0-820c86a39334640e99516928bd03fca88057d022/node_modules/mimic-fn/", {"name":"mimic-fn","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-signal-exit-3.0.2-b5fdc08f1287ea1178628e415e25132b73646c6d/node_modules/signal-exit/", {"name":"signal-exit","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-cli-width-2.2.0-ff19ede8a9a5e579324147b0c11f0fbcbabed639/node_modules/cli-width/", {"name":"cli-width","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-external-editor-3.1.0-cb03f740befae03ea4d283caed2741a83f335495/node_modules/external-editor/", {"name":"external-editor","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-chardet-0.7.0-90094849f0937f2eedc2425d0d28a9e5f0cbad9e/node_modules/chardet/", {"name":"chardet","reference":"0.7.0"}],
  ["../../Library/Caches/Yarn/v4/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b/node_modules/iconv-lite/", {"name":"iconv-lite","reference":"0.4.24"}],
  ["../../Library/Caches/Yarn/v4/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a/node_modules/safer-buffer/", {"name":"safer-buffer","reference":"2.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-tmp-0.0.33-6d34335889768d21b2bcda0aa277ced3b1bfadf9/node_modules/tmp/", {"name":"tmp","reference":"0.0.33"}],
  ["../../Library/Caches/Yarn/v4/npm-os-tmpdir-1.0.2-bbe67406c79aa85c5cfec766fe5734555dfa1274/node_modules/os-tmpdir/", {"name":"os-tmpdir","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-figures-2.0.0-3ab1a2d2a62c8bfb431a0c94cb797a2fce27c962/node_modules/figures/", {"name":"figures","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-4.17.15-b447f6670a0455bbfeedd11392eff330ea097548/node_modules/lodash/", {"name":"lodash","reference":"4.17.15"}],
  ["../../Library/Caches/Yarn/v4/npm-mute-stream-0.0.7-3075ce93bc21b8fab43e1bc4da7e8115ed1e7bab/node_modules/mute-stream/", {"name":"mute-stream","reference":"0.0.7"}],
  ["../../Library/Caches/Yarn/v4/npm-run-async-2.3.0-0371ab4ae0bdd720d4166d7dfda64ff7a445a6c0/node_modules/run-async/", {"name":"run-async","reference":"2.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-promise-2.1.0-79a2a9ece7f096e80f36d2b2f3bc16c1ff4bf3fa/node_modules/is-promise/", {"name":"is-promise","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-rxjs-6.5.3-510e26317f4db91a7eb1de77d9dd9ba0a4899a3a/node_modules/rxjs/", {"name":"rxjs","reference":"6.5.3"}],
  ["../../Library/Caches/Yarn/v4/npm-tslib-1.10.0-c3c19f95973fb0a62973fb09d90d961ee43e5c8a/node_modules/tslib/", {"name":"tslib","reference":"1.10.0"}],
  ["../../Library/Caches/Yarn/v4/npm-string-width-2.1.1-ab93f27a8dc13d28cac815c462143a6d9012ae9e/node_modules/string-width/", {"name":"string-width","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-is-fullwidth-code-point-2.0.0-a3b30a5c4f199183167aaab93beefae3ddfb654f/node_modules/is-fullwidth-code-point/", {"name":"is-fullwidth-code-point","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-strip-ansi-4.0.0-a8479022eb1ac368a871389b635262c505ee368f/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-strip-ansi-5.2.0-8c9a536feb6afc962bdfa5b104a5091c1ad9c0ae/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"5.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ansi-regex-3.0.0-ed0317c322064f79466c02966bddb605ab37d998/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ansi-regex-4.1.0-8b9f8f08cf1acb843756a839ca8c7e3168c51997/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"4.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-through-2.3.8-0dd4c9ffaabc357960b1b724115d7e0e86a2e1f5/node_modules/through/", {"name":"through","reference":"2.3.8"}],
  ["../../Library/Caches/Yarn/v4/npm-tar-pack-3.4.1-e1dbc03a9b9d3ba07e896ad027317eb679a10a1f/node_modules/tar-pack/", {"name":"tar-pack","reference":"3.4.1"}],
  ["../../Library/Caches/Yarn/v4/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/", {"name":"debug","reference":"2.6.9"}],
  ["../../Library/Caches/Yarn/v4/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/", {"name":"ms","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-fstream-1.0.12-4e8ba8ee2d48be4f7d0de505455548eae5932045/node_modules/fstream/", {"name":"fstream","reference":"1.0.12"}],
  ["../../Library/Caches/Yarn/v4/npm-mkdirp-0.5.1-30057438eac6cf7f8c4767f38648d6697d75c903/node_modules/mkdirp/", {"name":"mkdirp","reference":"0.5.1"}],
  ["../../Library/Caches/Yarn/v4/npm-minimist-0.0.8-857fcabfc3397d2625b8228262e86aa7a011b05d/node_modules/minimist/", {"name":"minimist","reference":"0.0.8"}],
  ["../../Library/Caches/Yarn/v4/npm-rimraf-2.7.1-35797f13a7fdadc566142c29d4f07ccad483e3ec/node_modules/rimraf/", {"name":"rimraf","reference":"2.7.1"}],
  ["../../Library/Caches/Yarn/v4/npm-glob-7.1.4-aa608a2f6c577ad357e1ae5a5c26d9a8d1969255/node_modules/glob/", {"name":"glob","reference":"7.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f/node_modules/fs.realpath/", {"name":"fs.realpath","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9/node_modules/inflight/", {"name":"inflight","reference":"1.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1/node_modules/once/", {"name":"once","reference":"1.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f/node_modules/wrappy/", {"name":"wrappy","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083/node_modules/minimatch/", {"name":"minimatch","reference":"3.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd/node_modules/brace-expansion/", {"name":"brace-expansion","reference":"1.1.11"}],
  ["../../Library/Caches/Yarn/v4/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767/node_modules/balanced-match/", {"name":"balanced-match","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b/node_modules/concat-map/", {"name":"concat-map","reference":"0.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/", {"name":"path-is-absolute","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-fstream-ignore-1.0.5-9c31dae34767018fe1d249b24dada67d092da105/node_modules/fstream-ignore/", {"name":"fstream-ignore","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-process-nextick-args-2.0.1-7820d9b16120cc55ca9ae7792680ae7dba6d7fe2/node_modules/process-nextick-args/", {"name":"process-nextick-args","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf/node_modules/util-deprecate/", {"name":"util-deprecate","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-tar-2.2.2-0ca8848562c7299b8b446ff6a4d60cdbb23edc40/node_modules/tar/", {"name":"tar","reference":"2.2.2"}],
  ["../../Library/Caches/Yarn/v4/npm-block-stream-0.0.9-13ebfe778a03205cfe03751481ebb4b3300c126a/node_modules/block-stream/", {"name":"block-stream","reference":"0.0.9"}],
  ["../../Library/Caches/Yarn/v4/npm-uid-number-0.0.6-0ea10e8035e8eb5b8e4449f06da1c730663baa81/node_modules/uid-number/", {"name":"uid-number","reference":"0.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-validate-npm-package-name-3.0.0-5fa912d81eb7d0c74afc140de7317f0ca7df437e/node_modules/validate-npm-package-name/", {"name":"validate-npm-package-name","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-builtins-1.0.3-cb94faeb61c8696451db36534e1422f94f0aee88/node_modules/builtins/", {"name":"builtins","reference":"1.0.3"}],
  ["./", topLevelLocator],
]);
exports.findPackageLocator = function findPackageLocator(location) {
  let relativeLocation = normalizePath(path.relative(__dirname, location));

  if (!relativeLocation.match(isStrictRegExp))
    relativeLocation = `./${relativeLocation}`;

  if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
    relativeLocation = `${relativeLocation}/`;

  let match;

  if (relativeLocation.length >= 145 && relativeLocation[144] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 145)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 141 && relativeLocation[140] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 141)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 135 && relativeLocation[134] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 135)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 127 && relativeLocation[126] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 127)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 126 && relativeLocation[125] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 126)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 125 && relativeLocation[124] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 125)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 123 && relativeLocation[122] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 123)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 121 && relativeLocation[120] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 121)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 119 && relativeLocation[118] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 119)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 117 && relativeLocation[116] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 117)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 116 && relativeLocation[115] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 116)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 115 && relativeLocation[114] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 115)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 114 && relativeLocation[113] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 114)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 113 && relativeLocation[112] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 113)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 111 && relativeLocation[110] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 111)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 110 && relativeLocation[109] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 110)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 109 && relativeLocation[108] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 109)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 107 && relativeLocation[106] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 107)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 106 && relativeLocation[105] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 106)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 105 && relativeLocation[104] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 105)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 103 && relativeLocation[102] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 103)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 102 && relativeLocation[101] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 102)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 101 && relativeLocation[100] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 101)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 99 && relativeLocation[98] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 99)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 2 && relativeLocation[1] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 2)))
      return blacklistCheck(match);

  return null;
};


/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "null")`,
        {
          request,
          issuer,
        }
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer,
          }
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName}
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName}
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName}
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates}
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)}
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {}
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath}
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {considerBuiltins});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer,
          }
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath, {extensions});
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    for (const [filter, patchFn] of patchedModules) {
      if (filter.test(request)) {
        module.exports = patchFn(exports.findPackageLocator(parent.filename), module.exports);
      }
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    let issuers;

    if (options) {
      const optionNames = new Set(Object.keys(options));
      optionNames.delete('paths');

      if (optionNames.size > 0) {
        throw makeError(
          `UNSUPPORTED`,
          `Some options passed to require() aren't supported by PnP yet (${Array.from(optionNames).join(', ')})`
        );
      }

      if (options.paths) {
        issuers = options.paths.map(entry => `${path.normalize(entry)}/`);
      }
    }

    if (!issuers) {
      const issuerModule = getIssuerModule(parent);
      const issuer = issuerModule ? issuerModule.filename : `${process.cwd()}/`;

      issuers = [issuer];
    }

    let firstError;

    for (const issuer of issuers) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, issuer);
      } catch (error) {
        firstError = firstError || error;
        continue;
      }

      return resolution !== null ? resolution : request;
    }

    throw firstError;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);
};

exports.setupCompatibilityLayer = () => {
  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // Modern versions of `resolve` support a specific entry point that custom resolvers can use
  // to inject a specific resolution logic without having to patch the whole package.
  //
  // Cf: https://github.com/browserify/resolve/pull/174

  patchedModules.push([
    /^\.\/normalize-options\.js$/,
    (issuer, normalizeOptions) => {
      if (!issuer || issuer.name !== 'resolve') {
        return normalizeOptions;
      }

      return (request, opts) => {
        opts = opts || {};

        if (opts.forceNodeResolution) {
          return opts;
        }

        opts.preserveSymlinks = true;
        opts.paths = function(request, basedir, getNodeModulesDir, opts) {
          // Extract the name of the package being requested (1=full name, 2=scope name, 3=local name)
          const parts = request.match(/^((?:(@[^\/]+)\/)?([^\/]+))/);

          // make sure that basedir ends with a slash
          if (basedir.charAt(basedir.length - 1) !== '/') {
            basedir = path.join(basedir, '/');
          }
          // This is guaranteed to return the path to the "package.json" file from the given package
          const manifestPath = exports.resolveToUnqualified(`${parts[1]}/package.json`, basedir);

          // The first dirname strips the package.json, the second strips the local named folder
          let nodeModules = path.dirname(path.dirname(manifestPath));

          // Strips the scope named folder if needed
          if (parts[2]) {
            nodeModules = path.dirname(nodeModules);
          }

          return [nodeModules];
        };

        return opts;
      };
    },
  ]);
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}
